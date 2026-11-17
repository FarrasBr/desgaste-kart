/* Sincronização entre aparelhos (Firebase: login + Firestore).

   Como funciona:
   - Os dados continuam salvos no aparelho (localStorage), e o app funciona offline como antes.
   - Com login e uma "garagem", cada registro (pneu, ciclo de óleo, consumível, equipamento,
     motor, jogo aposentado e configuração de peso) vira um documento em
     garages/{garagem}/items/{chave}.
   - A cada salvamento, comparamos o estado atual com o último estado sincronizado ("shadow")
     e enviamos só o que mudou. Exclusões viram marcações (deleted: true) para que os outros
     aparelhos também apaguem o registro.
   - Mudanças de outros aparelhos chegam em tempo real e substituem o registro local inteiro
     (vale a alteração mais recente).
   - Sem internet, o Firestore guarda as alterações no aparelho e envia quando a conexão volta. */
(function () {
  "use strict";

  var META_KEY = "kart-desgaste:sync";
  var SDK = [
    "vendor/firebase/firebase-app-compat.js",
    "vendor/firebase/firebase-auth-compat.js",
    "vendor/firebase/firebase-firestore-compat.js",
  ];
  var INVITE_DAYS = 7;
  var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  var App = window.KartApp;
  var auth = null,
    db = null,
    user = null,
    gid = null,
    garage = null,
    unsubItems = null,
    unsubGarage = null,
    attached = false,
    pending = false,
    dirty = false,
    flushTimer = null,
    phase = "off", // off | loading | signedOut | lookup | noGarage | garage | error
    fatal = "",
    view = "main", // signedOut: main | email ; noGarage: main | join
    joinMode = "merge",
    invite = null,
    busy = false,
    lastBody = "",
    inviteFromUrl = "";

  var meta = loadMeta();

  /* ---------- utilidades ---------- */
  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function loadMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (m && typeof m === "object") {
        if (!m.shadow || typeof m.shadow !== "object") m.shadow = {};
        return m;
      }
    } catch (e) {
      /* começa vazio */
    }
    return { shadow: {} };
  }
  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      /* ignora */
    }
  }
  function sigOf(json, pos) {
    return (pos === null || pos === undefined ? "" : pos) + "|" + json;
  }
  function online() {
    return navigator.onLine !== false;
  }
  function setMsg(t) {
    var m = $("sync-msg");
    if (m) m.textContent = t || "";
  }
  function userName(u) {
    if (!u) return "";
    return u.displayName || (u.email ? u.email.split("@")[0] : "Usuário");
  }
  function errText(err) {
    var c = (err && err.code) || "";
    var map = {
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/wrong-password": "E-mail ou senha incorretos.",
      "auth/user-not-found": "Não existe conta com esse e-mail. Use “Criar conta”.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/missing-password": "Digite a senha.",
      "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Use “Entrar”.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
      "auth/popup-closed-by-user": "Login cancelado.",
      "auth/cancelled-popup-request": "Login cancelado.",
      "auth/popup-blocked": "O navegador bloqueou a janela de login. Permita pop-ups e tente de novo.",
      "auth/network-request-failed": "Sem internet. Tente de novo quando estiver conectado.",
      "auth/unauthorized-domain": "Este endereço não está autorizado no Firebase (Authentication → Configurações → Domínios autorizados).",
      "auth/operation-not-allowed": "Este tipo de login não foi ativado no Firebase (Authentication → Método de login).",
      "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
      "permission-denied": "Sem permissão. Confira as regras do Firestore ou se você ainda faz parte da garagem.",
      unavailable: "Sem conexão com o servidor. Tente de novo quando estiver online.",
    };
    return map[c] || "Algo deu errado" + (c ? " (" + c + ")" : "") + ".";
  }

  /* ---------- carregamento ---------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Falha ao carregar " + src));
      };
      document.head.appendChild(s);
    });
  }

  function boot() {
    try {
      var p = new URLSearchParams(location.search);
      var c = p.get("convite");
      if (c) {
        inviteFromUrl = normCode(c);
        p.delete("convite");
        var q = p.toString();
        history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      }
    } catch (e) {
      /* ignora */
    }

    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushNow();
    });
    var body = $("sync-body");
    if (body) {
      body.addEventListener("click", onClick);
      body.addEventListener("submit", function (e) {
        e.preventDefault();
      });
      body.addEventListener("change", function (e) {
        if (e.target && e.target.name === "join-mode") joinMode = e.target.value;
      });
    }

    if (!window.FIREBASE_CONFIG || !App) {
      phase = "off";
      render();
      return;
    }
    if (inviteFromUrl && $("sync")) $("sync").open = true;
    phase = "loading";
    render();
    SDK.reduce(function (p, src) {
      return p.then(function () {
        return loadScript(src);
      });
    }, Promise.resolve())
      .then(init)
      .catch(function () {
        phase = "error";
        fatal = "Não foi possível carregar a sincronização. Abra o app com internet uma vez para baixá-la.";
        render();
      });
  }

  function init() {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(function () {
      /* sem cache offline neste navegador: segue funcionando online */
    });
    auth.onAuthStateChanged(onUser);
  }

  /* ---------- login ---------- */
  function onUser(u) {
    detach();
    user = u;
    invite = null;
    if (!u) {
      phase = "signedOut";
      view = "main";
      render();
      return;
    }
    if (meta.uid && meta.uid !== u.uid) meta = { shadow: {} };
    meta.uid = u.uid;
    saveMeta();
    if (meta.gid) {
      attach(meta.gid);
      return;
    }
    phase = "lookup";
    render();
    db.doc("users/" + u.uid)
      .get()
      .then(function (s) {
        if (user !== u) return;
        var g = s.exists && s.data().gid;
        if (g) attach(g);
        else {
          phase = "noGarage";
          view = inviteFromUrl ? "join" : "main";
          render();
        }
      })
      .catch(function (err) {
        if (user !== u) return;
        phase = "noGarage";
        render();
        setMsg(errText(err));
      });
  }

  function loginGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return auth.signInWithPopup(provider);
  }
  function emailFields() {
    return {
      email: ($("sync-email").value || "").trim(),
      pass: $("sync-pass").value || "",
    };
  }

  function signOut() {
    flushNow();
    detach();
    meta = { shadow: {} };
    saveMeta();
    return auth.signOut();
  }

  /* ---------- garagem ---------- */
  function normCode(c) {
    return String(c || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12);
  }
  function newCode() {
    var a = new Uint32Array(8),
      out = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) out += CODE_CHARS[a[i] % CODE_CHARS.length];
    return out;
  }

  function createGarage() {
    var ref = db.collection("garages").doc();
    var names = {};
    names[user.uid] = userName(user);
    var b = db.batch();
    b.set(ref, {
      owner: user.uid,
      members: [user.uid],
      names: names,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    b.set(db.doc("users/" + user.uid), { gid: ref.id });
    return b.commit().then(function () {
      attach(ref.id);
    });
  }

  function joinGarage(code) {
    var inv;
    return db
      .doc("invites/" + code)
      .get()
      .then(function (s) {
        if (!s.exists) throw { code: "x/invalid-code" };
        inv = s.data();
        if (inv.expiresAt && inv.expiresAt.toMillis() < Date.now()) throw { code: "x/expired-code" };
        var upd = {
          members: firebase.firestore.FieldValue.arrayUnion(user.uid),
          joinCode: code,
        };
        upd["names." + user.uid] = userName(user);
        return db.doc("garages/" + inv.gid).update(upd);
      })
      .then(function () {
        return db.doc("users/" + user.uid).set({ gid: inv.gid });
      })
      .then(function () {
        if (joinMode === "replace") App.clearData();
        inviteFromUrl = "";
        attach(inv.gid);
      });
  }

  function createInvite() {
    var code = newCode();
    var exp = Date.now() + INVITE_DAYS * 864e5;
    return db
      .doc("invites/" + code)
      .set({
        gid: gid,
        by: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        expiresAt: firebase.firestore.Timestamp.fromMillis(exp),
      })
      .then(function () {
        invite = { code: code, expiresAt: exp };
      });
  }
  function inviteLink(code) {
    return location.origin + location.pathname + "?convite=" + code;
  }

  function leaveGarage() {
    var g = gid,
      uidNow = user.uid;
    flushNow();
    detach();
    meta.gid = null;
    meta.shadow = {};
    meta.attached = false;
    saveMeta();
    phase = "noGarage";
    view = "main";
    render();
    var upd = { members: firebase.firestore.FieldValue.arrayRemove(uidNow) };
    upd["names." + uidNow] = firebase.firestore.FieldValue.delete();
    return db
      .doc("garages/" + g)
      .update(upd)
      .then(function () {
        return db.doc("users/" + uidNow).set({ gid: null });
      });
  }

  /* ---------- sincronização ---------- */
  function attach(g) {
    detach();
    gid = g;
    if (meta.gid !== g) {
      meta.gid = g;
      meta.shadow = {};
      meta.attached = false;
      saveMeta();
    }
    attached = !!meta.attached;
    phase = "garage";
    view = "main";
    render();
    unsubGarage = db.doc("garages/" + g).onSnapshot(function (s) {
      garage = s.exists ? s.data() : null;
      render();
    }, onListenError);
    unsubItems = db
      .collection("garages/" + g + "/items")
      .onSnapshot({ includeMetadataChanges: true }, onItems, onListenError);
  }

  function detach() {
    if (unsubItems) unsubItems();
    if (unsubGarage) unsubGarage();
    unsubItems = unsubGarage = null;
    gid = null;
    garage = null;
    attached = false;
    clearTimeout(flushTimer);
  }

  function onListenError(err) {
    if (err && err.code === "permission-denied") {
      // Saiu (ou foi removido) da garagem, ou as regras mudaram.
      detach();
      meta.gid = null;
      meta.shadow = {};
      meta.attached = false;
      saveMeta();
      phase = "noGarage";
      view = "main";
      render();
      setMsg("Você não tem mais acesso a essa garagem. Os dados continuam salvos neste aparelho.");
      return;
    }
    setMsg(errText(err));
    render();
  }

  function onItems(snap) {
    // A primeira sincronização de um aparelho precisa da resposta do servidor,
    // para não ressuscitar registros que foram apagados em outro aparelho.
    if (!attached && snap.metadata.fromCache) {
      render();
      return;
    }
    if (attached && !snap.docChanges().length) {
      render();
      return;
    }
    if (dirty) flushNow();

    var cur = App.snapshot();
    var changes = [];
    snap.docs.forEach(function (doc) {
      var key = doc.id,
        d = doc.data();
      if (d.deleted) {
        if (key in meta.shadow || key in cur) {
          delete meta.shadow[key];
          if (key in cur) changes.push({ key: key, deleted: true });
        }
        return;
      }
      if (typeof d.json !== "string") return;
      var sig = sigOf(d.json, d.pos);
      if (meta.shadow[key] === sig) return;
      meta.shadow[key] = sig;
      var local = cur[key];
      if (local && sigOf(JSON.stringify(local.data), local.pos) === sig) return;
      try {
        changes.push({ key: key, data: JSON.parse(d.json), pos: d.pos === undefined ? null : d.pos });
      } catch (e) {
        /* documento corrompido: ignora */
      }
    });

    if (!attached) {
      attached = true;
      meta.attached = true;
    }
    saveMeta();
    if (changes.length) App.apply(changes);
    flushNow();
    render();
  }

  function changed() {
    if (!gid) return;
    dirty = true;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, 700);
    render();
  }

  function flushNow() {
    clearTimeout(flushTimer);
    if (!gid || !attached || !db || !user) return;
    dirty = false;
    var cur = App.snapshot();
    var ops = [];
    Object.keys(cur).forEach(function (key) {
      var r = cur[key];
      var json = JSON.stringify(r.data);
      var pos = r.pos === undefined ? null : r.pos;
      var sig = sigOf(json, pos);
      if (meta.shadow[key] === sig) return;
      meta.shadow[key] = sig;
      ops.push([key, { col: r.col, json: json, pos: pos, deleted: false }]);
    });
    Object.keys(meta.shadow).forEach(function (key) {
      if (key in cur) return;
      delete meta.shadow[key];
      ops.push([key, { col: key.split("~")[0], json: null, pos: null, deleted: true }]);
    });
    if (!ops.length) {
      render();
      return;
    }
    saveMeta();

    var col = db.collection("garages/" + gid + "/items");
    var stamp = firebase.firestore.FieldValue.serverTimestamp();
    for (var i = 0; i < ops.length; i += 400) {
      var b = db.batch();
      ops.slice(i, i + 400).forEach(function (op) {
        op[1].updatedAt = stamp;
        op[1].by = user.uid;
        b.set(col.doc(op[0]), op[1]);
      });
      b.commit().catch(onWriteError);
    }
    pending = true;
    render();
    db.waitForPendingWrites().then(function () {
      pending = false;
      render();
    });
  }

  function onWriteError(err) {
    // Para não perder nada: na próxima conexão o aparelho refaz a mesclagem completa.
    meta.shadow = {};
    meta.attached = false;
    saveMeta();
    attached = false;
    pending = false;
    setMsg("Não foi possível enviar alterações: " + errText(err));
    render();
  }

  /* ---------- interface ---------- */
  function statusLine() {
    if (phase === "off") return { cls: "off", text: "desligada" };
    if (phase === "loading") return { cls: "wait", text: "carregando…" };
    if (phase === "error") return { cls: "err", text: "erro" };
    if (phase === "signedOut") return { cls: "off", text: "desconectado" };
    if (phase === "lookup" || phase === "noGarage") return { cls: "off", text: "sem garagem" };
    if (!online()) return { cls: "wait", text: pending || dirty ? "offline · alterações pendentes" : "offline" };
    if (!attached) return { cls: "wait", text: "conectando…" };
    if (pending || dirty) return { cls: "wait", text: "enviando…" };
    return { cls: "ok", text: "sincronizado" };
  }

  function bodyHtml() {
    if (phase === "off")
      return (
        '<p class="hint-p">A sincronização entre aparelhos ainda não foi configurada neste app ' +
        "(arquivo <code>firebase-config.js</code>). Enquanto isso, tudo continua funcionando só neste aparelho.</p>"
      );
    if (phase === "loading" || phase === "lookup") return '<p class="hint-p">Carregando…</p>';
    if (phase === "error") return '<p class="hint-p">' + esc(fatal) + "</p>";

    if (phase === "signedOut") {
      var intro =
        '<p class="hint-p">Entre com uma conta para manter os dados iguais em todos os seus aparelhos ' +
        "e compartilhar com outras pessoas. Você só entra uma vez em cada aparelho. " +
        "Sem entrar, o app continua funcionando só neste aparelho.</p>";
      if (view === "email")
        return (
          intro +
          '<form autocomplete="on">' +
          '<label>E-mail<input type="email" id="sync-email" autocomplete="username" inputmode="email"></label>' +
          '<label>Senha<input type="password" id="sync-pass" autocomplete="current-password" minlength="6"></label>' +
          '<div class="actions2">' +
          '<button type="button" class="primary" data-act="email-in">Entrar</button>' +
          '<button type="button" class="ghost grow" data-act="email-new">Criar conta</button>' +
          "</div>" +
          '<div class="actions2">' +
          '<button type="button" class="ghost grow" data-act="email-reset">Esqueci a senha</button>' +
          '<button type="button" class="ghost grow" data-act="view-main">Voltar</button>' +
          "</div></form>"
        );
      return (
        intro +
        '<button type="button" class="primary" data-act="google">Entrar com Google</button>' +
        '<div class="actions2"><button type="button" class="ghost grow" data-act="view-email">Entrar com e-mail e senha</button></div>'
      );
    }

    var who =
      '<p class="hint-p">Conectado como <strong>' +
      esc(userName(user)) +
      "</strong>" +
      (user.email ? " (" + esc(user.email) + ")" : "") +
      ".</p>";

    if (phase === "noGarage") {
      if (view === "join") {
        var hasData = App.hasData();
        return (
          who +
          '<label>Código de convite<input type="text" id="sync-code" autocomplete="off" autocapitalize="characters" ' +
          'spellcheck="false" maxlength="12" value="' +
          esc(inviteFromUrl) +
          '"></label>' +
          (hasData
            ? '<div class="lbl">Este aparelho já tem dados. O que fazer com eles?</div>' +
              '<label class="chk-label"><input type="radio" name="join-mode" value="merge"' +
              (joinMode === "merge" ? " checked" : "") +
              "> Juntar com os dados da garagem</label>" +
              '<label class="chk-label"><input type="radio" name="join-mode" value="replace"' +
              (joinMode === "replace" ? " checked" : "") +
              "> Descartar e usar só os da garagem</label>"
            : "") +
          '<div class="actions2">' +
          '<button type="button" class="primary" data-act="join">Entrar na garagem</button>' +
          '<button type="button" class="ghost grow" data-act="view-main">Voltar</button>' +
          "</div>"
        );
      }
      return (
        who +
        '<p class="hint-p">Os dados ficam numa <strong>garagem</strong>. Crie a sua (os dados deste aparelho vão para ela) ' +
        "ou entre na garagem de outra pessoa com um código de convite.</p>" +
        '<button type="button" class="primary" data-act="create">Criar minha garagem</button>' +
        '<div class="actions2">' +
        '<button type="button" class="ghost grow" data-act="view-join">Tenho um código de convite</button>' +
        '<button type="button" class="ghost grow" data-act="signout">Sair da conta</button>' +
        "</div>"
      );
    }

    // phase === "garage"
    var names = (garage && garage.names) || {};
    var members = ((garage && garage.members) || []).map(function (id) {
      return esc(names[id] || "Membro") + (id === user.uid ? " (você)" : "") + (garage.owner === id ? " · dono" : "");
    });
    var inv = "";
    if (invite) {
      var link = inviteLink(invite.code);
      inv =
        '<div class="sync-invite">' +
        '<div class="lbl">Código de convite (vale ' +
        INVITE_DAYS +
        " dias)</div>" +
        '<div class="sync-code">' +
        esc(invite.code) +
        "</div>" +
        '<p class="hint-p">Na outra pessoa: abrir o app → Sincronização → entrar com a conta dela → ' +
        "“Tenho um código de convite”. Ou envie o link:</p>" +
        '<p class="hint-p sync-link">' +
        esc(link) +
        "</p>" +
        '<div class="actions2">' +
        (navigator.share ? '<button type="button" class="ghost grow" data-act="share">Compartilhar link</button>' : "") +
        '<button type="button" class="ghost grow" data-act="copy">Copiar link</button>' +
        "</div></div>";
    }
    return (
      who +
      '<div class="lbl">Membros da garagem</div>' +
      '<ul class="sync-members">' +
      (members.length
        ? members
            .map(function (m) {
              return "<li>" + m + "</li>";
            })
            .join("")
        : "<li>…</li>") +
      "</ul>" +
      '<p class="hint-p">As alterações são enviadas automaticamente. Sem internet, ficam guardadas e são enviadas quando a conexão voltar. ' +
      "Continue exportando backups de vez em quando.</p>" +
      inv +
      '<div class="actions2">' +
      '<button type="button" class="ghost grow" data-act="invite">' +
      (invite ? "Gerar outro código" : "Convidar alguém") +
      "</button>" +
      "</div>" +
      '<div class="actions2">' +
      '<button type="button" class="ghost grow" data-act="leave">Sair da garagem</button>' +
      '<button type="button" class="ghost grow" data-act="signout">Sair da conta</button>' +
      "</div>"
    );
  }

  function render() {
    var st = statusLine();
    var el = $("sync-state");
    if (el) {
      el.className = "sync-state " + st.cls;
      el.textContent = st.text;
    }
    var body = $("sync-body");
    if (!body) return;
    var html = bodyHtml();
    if (html !== lastBody) {
      lastBody = html;
      body.innerHTML = html;
    }
    var bs = body.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) bs[i].disabled = busy;
  }

  function run(promise, okMsg) {
    busy = true;
    setMsg("");
    render();
    return Promise.resolve(promise)
      .then(function () {
        if (okMsg) App.toast(okMsg);
      })
      .catch(function (err) {
        var c = err && err.code;
        setMsg(
          c === "x/invalid-code"
            ? "Código não encontrado. Confira as letras e números."
            : c === "x/expired-code"
              ? "Este código expirou. Peça um novo."
              : errText(err),
        );
      })
      .then(function () {
        busy = false;
        render();
      });
  }

  function onClick(e) {
    var b = e.target.closest("button[data-act]");
    if (!b || busy) return;
    var act = b.dataset.act;
    var f;
    switch (act) {
      case "view-main":
      case "view-email":
      case "view-join":
        view = act.slice(5);
        setMsg("");
        render();
        break;
      case "google":
        run(loginGoogle());
        break;
      case "email-in":
        f = emailFields();
        run(auth.signInWithEmailAndPassword(f.email, f.pass));
        break;
      case "email-new":
        f = emailFields();
        run(auth.createUserWithEmailAndPassword(f.email, f.pass));
        break;
      case "email-reset":
        f = emailFields();
        if (!f.email) {
          setMsg("Digite seu e-mail acima e toque de novo em “Esqueci a senha”.");
          break;
        }
        run(auth.sendPasswordResetEmail(f.email), "Enviamos um e-mail para redefinir a senha.");
        break;
      case "create":
        if (!online()) {
          setMsg("Conecte-se à internet para criar a garagem.");
          break;
        }
        run(createGarage(), "Garagem criada. Os dados deste aparelho estão sendo enviados.");
        break;
      case "join":
        var code = normCode($("sync-code").value);
        if (code.length < 6) {
          setMsg("Digite o código de convite.");
          break;
        }
        if (!online()) {
          setMsg("Conecte-se à internet para entrar na garagem.");
          break;
        }
        if (
          joinMode === "replace" &&
          App.hasData() &&
          !confirm("Apagar os dados deste aparelho e usar só os da garagem?")
        )
          break;
        run(joinGarage(code), "Você entrou na garagem.");
        break;
      case "invite":
        run(createInvite());
        break;
      case "share":
        navigator.share({ title: "Desgaste do kart", text: "Convite para a garagem do Desgaste do kart", url: inviteLink(invite.code) }).catch(function () {});
        break;
      case "copy":
        var link = inviteLink(invite.code);
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
          .then(function () {
            App.toast("Link copiado.");
          })
          .catch(function () {
            prompt("Copie o link:", link);
          });
        break;
      case "leave":
        if (!confirm("Sair da garagem? Os dados continuam neste aparelho, mas deixam de sincronizar.")) break;
        run(leaveGarage(), "Você saiu da garagem.");
        break;
      case "signout":
        if (!confirm("Sair da conta? Os dados continuam neste aparelho, mas deixam de sincronizar.")) break;
        run(signOut());
        break;
    }
  }

  window.KartSync = { changed: changed, flush: flushNow };
  boot();
})();
