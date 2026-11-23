/* Módulo de Acerto do App 3. Veio do app de telemetria (pressao-kart v10).
   Guarda o acerto de cada kart, o log de alterações e gera o .md no formato do modelo. */
(function () {
  "use strict";
  var KEY = "kart-app3:acerto";
  var KARTS = window.KARTS;
  var K0 = KARTS[0].id;
  var MODELO = window.ACERTO_MODELO;
  var CAMPOS = MODELO.filter(function (l) { return l.t === "field"; });
  var state = { drafts: {}, pending: {}, origemPendente: {}, acertoLog: [], kartAtivo: K0 };
  var impPend = null;
  var resetFlag = {};
  var api = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isKart(id) { return KARTS.some(function (k) { return k.id === id; }); }
  function kartNome(id) {
    var k = KARTS.filter(function (x) { return x.id === id; })[0];
    return k ? k.nome : id ? String(id) : "Kart não informado";
  }
  function toast(t) { if (window.KartApp) window.KartApp.toast(t); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

        /* ---------- datas ---------- */
        function nowLocalInput() { return toLocalInput(new Date()); }
        function toLocalInput(d) {
          return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }
        // "2026-11-17T14:32" (hora local) -> "2026-11-17T14:32:00-03:00"
        function localInputToIso(v) {
          var d = new Date(v);
          if (isNaN(d)) return null;
          var off = -d.getTimezoneOffset();
          var sign = off >= 0 ? "+" : "-";
          off = Math.abs(off);
          return toLocalInput(d) + ":00" + sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60);
        }
        // agora, com segundos: "2026-11-17T21:43:07-03:00"
        function nowIso() {
          var d = new Date(), iso = localInputToIso(toLocalInput(d));
          return iso.slice(0, 17) + pad(d.getSeconds()) + iso.slice(19);
        }
        function fmtDateTime(iso) {
          var d = new Date(iso);
          if (isNaN(d)) return String(iso);
          return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }
        // Mesmo padrão dos arquivos: "Acerto - 2026_11_21 - Praga.md"
        function mdName(kart, iso) {
          var k = KARTS.filter(function (x) { return x.id === kart; })[0];
          var nome = k ? k.arquivo : kart ? String(kart).replace(/[\\/:*?"<>|]/g, "") : "";
          return "Acerto - " + String(iso).slice(0, 10).replace(/-/g, "_") + (nome ? " - " + nome : "") + ".md";
        }
        function hoje() { return nowIso().slice(0, 10); }
        function fmtDia(key) { return key.slice(8, 10) + "/" + key.slice(5, 7) + "/" + key.slice(0, 4); }

        /* ---------- acerto ---------- */
        function acertoPadrao() {
          var a = {};
          CAMPOS.forEach(function (f) { a[f.key] = f.def === "" ? null : f.def; });
          return a;
        }
        function cleanAcerto(src, fill) {
          var a = {};
          src = src && typeof src === "object" ? src : {};
          CAMPOS.forEach(function (f) {
            if (Object.prototype.hasOwnProperty.call(src, f.key)) {
              var v = src[f.key];
              a[f.key] = v == null || String(v).trim() === "" ? null : String(v).trim();
            } else {
              a[f.key] = fill ? fill[f.key] : null;
            }
          });
          // mantém valores de campos que saíram do modelo, para não perder dados
          Object.keys(src).forEach(function (k) { if (!(k in a)) a[k] = src[k]; });
          return a;
        }
        function diffAcerto(de, para) {
          var muds = [];
          CAMPOS.forEach(function (f) {
            var a = de[f.key] == null ? null : String(de[f.key]).trim();
            var b = para[f.key] == null ? null : String(para[f.key]).trim();
            if (a !== b) muds.push({ key: f.key, de: a, para: b });
          });
          return muds;
        }
        function isDirty(k) { return !!state.pending[k] && diffAcerto(state.drafts[k], state.pending[k]).length > 0; }
        // acerto mostrado na aba Acerto
        function viewAcerto() {
          return state.pending[state.kartAtivo] || state.drafts[state.kartAtivo];
        }
        // acerto que recebe o que é digitado (cria a edição pendente na primeira mudança)
        function workAcerto() {
          var k = state.kartAtivo;
          if (!state.pending[k]) state.pending[k] = cleanAcerto(state.drafts[k]);
          return state.pending[k];
        }
        function afterAcertoInput() {
          var k = state.kartAtivo;
          if (state.pending[k] && !isDirty(k)) {
            delete state.pending[k];
            delete state.origemPendente[k];
          }
          persist();
          renderSaveState();
        }

        // Gera o .md no mesmo formato do "Acerto - BASE.md"
        function acertoMd(acerto) {
          return MODELO.map(function (l) {
            if (l.t === "blank") return "";
            if (l.t === "line") return l.text;
            var v = acerto[l.key];
            return " ".repeat(l.indent) + (l.bullet ? "- " : "") + l.label + ":" + (v != null && v !== "" ? " " + v : "");
          }).join("\r\n") + "\r\n"; // os arquivos de acerto usam quebra de linha do Windows
        }

                function cleanLogEntry(e) {
          if (!e || typeof e !== "object" || !e.ts || isNaN(new Date(e.ts)) || !e.acerto) return null;
          return {
            id: e.id ? String(e.id) : uid(),
            ts: String(e.ts),
            kart: e.kart ? String(e.kart) : K0,
            tipo: e.tipo === "redefinir" || e.tipo === "importado" ? e.tipo : "alteracao",
            arquivo: e.arquivo ? String(e.arquivo) : null,
            mudancas: (Array.isArray(e.mudancas) ? e.mudancas : []).filter(function (m) { return m && m.key; }).map(function (m) {
              return { key: String(m.key), de: m.de == null ? null : String(m.de), para: m.para == null ? null : String(m.para) };
            }),
            acerto: cleanAcerto(e.acerto),
          };
        }
                // mais recente primeiro; no empate, o gravado por último vem primeiro
        function logSorted(kart) {
          return state.acertoLog
            .map(function (e, i) { return { e: e, i: i }; })
            .filter(function (x) { return !kart || x.e.kart === kart; })
            .sort(function (a, b) { return new Date(b.e.ts) - new Date(a.e.ts) || b.i - a.i; })
            .map(function (x) { return x.e; });
        }
        
  function load() {
    var d = null, pad0 = acertoPadrao();
    try { d = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (d && typeof d === "object") {
      if (Array.isArray(d.acertoLog)) state.acertoLog = d.acertoLog.map(cleanLogEntry).filter(Boolean);
      if (isKart(d.kartAtivo)) state.kartAtivo = d.kartAtivo;
      KARTS.forEach(function (k) {
        if (d.drafts && d.drafts[k.id]) state.drafts[k.id] = cleanAcerto(d.drafts[k.id], pad0);
        if (d.pending && d.pending[k.id]) {
          state.pending[k.id] = cleanAcerto(d.pending[k.id], pad0);
          if (d.origemPendente && typeof d.origemPendente[k.id] === "string") state.origemPendente[k.id] = d.origemPendente[k.id];
        }
      });
    }
    KARTS.forEach(function (k) {
      if (state.drafts[k.id]) return;
      var last = logSorted(k.id)[0];
      state.drafts[k.id] = last ? cleanAcerto(last.acerto) : acertoPadrao();
    });
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast("Não foi possível salvar neste aparelho.");
      return false;
    }
  }

        /* ---------- tela Acerto: árvore recolhível montada a partir do modelo ----------
           Níveis iguais aos do .md:  # (1) > ## (2) > ### (3) > item "- Grupo:" (4) > campos recuados */
        var TREE = (function () {
          var root = { lv: 0, kids: [], path: "" };
          var stack = [root];
          var paths = {}; // chave do campo -> "Dianteira › Direita › Bitola"
          function top() { return stack[stack.length - 1]; }
          function popTo(lv) { while (top().lv >= lv) stack.pop(); }
          function names() { return stack.slice(1).map(function (n) { return n.title; }); }
          MODELO.forEach(function (l) {
            if (l.t === "blank") return;
            if (l.t === "line") {
              var t = l.text, m = /^(#{1,3}) (.*)$/.exec(t), node;
              if (m) {
                popTo(m[1].length);
                node = { lv: m[1].length, title: m[2].replace(/:$/, ""), kids: [] };
              } else if (/^- /.test(t)) {
                popTo(4);
                node = { lv: 4, title: t.slice(2).replace(/:$/, ""), kids: [] };
              } else {
                if (top().lv === 4) stack.pop();
                top().kids.push({ note: t.replace(/^>\s*/, "").replace(/_/g, "") });
                return;
              }
              node.path = top().path + "/" + node.title;
              top().kids.push(node);
              stack.push(node);
              return;
            }
            if (!l.indent && top().lv === 4) stack.pop();
            paths[l.key] = names().slice(1).concat(l.label).join(" › ");
            top().kids.push({ field: l });
          });
          return { root: root, paths: paths };
        })();
        var openSet = {}; // quais níveis estão abertos (só nesta sessão)

        function renderKartTabs() {
          var cur = state.kartAtivo;
          $("a-karts").innerHTML = KARTS.map(function (k) {
            return '<button type="button" role="tab" data-akart="' + esc(k.id) + '" aria-selected="' + (k.id === cur ? "true" : "false") + '"' +
              (isDirty(k.id) ? ' class="dirty"' : "") + ">" + esc(k.nome) + "</button>";
          }).join("");
        }
        function renderAcerto() {
          var a = viewAcerto();
          $("a-note").textContent = "Acerto atual do " + kartNome(state.kartAtivo) + ". Altere os campos e toque em Salvar; só então a alteração vai para o log.";
          function node(n) {
            if (n.note) return '<p class="hint-p">' + esc(n.note) + "</p>";
            if (n.field) {
              var v = a[n.field.key];
              if (n.field.tipo === "onoff" || n.field.tipo === "onoff-texto") {
                var comTexto = n.field.tipo === "onoff-texto";
                return '<div class="onoff' + (comTexto ? " comtexto" : "") + '"><span class="lbl">' + esc(n.field.label) + '</span><div class="seg" role="group" aria-label="' + esc(n.field.label) + '">' +
                  ["ON", "OFF"].map(function (o) {
                    return '<button type="button" data-onoff="' + esc(n.field.key) + '" data-val="' + o + '" aria-pressed="' + (v === o ? "true" : "false") + '">' + o + "</button>";
                  }).join("") + "</div>" +
                  (comTexto ? '<input type="text" data-key="' + esc(n.field.key) + '" autocomplete="off" placeholder="Ou digite (ex.: Nylon)" aria-label="' + esc(n.field.label) + '" value="' + esc(v === "ON" || v === "OFF" || v == null ? "" : v) + '" />' : "") +
                  "</div>";
              }
              return '<label>' + esc(n.field.label) +
                '<input type="text" data-key="' + esc(n.field.key) + '" autocomplete="off" value="' + esc(v == null ? "" : v) + '" /></label>';
            }
            return '<details class="lv' + n.lv + (n.lv === 1 ? " card" : "") + '" data-path="' + esc(n.path) + '"' +
              (openSet[n.path] ? " open" : "") + "><summary>" + esc(n.title) + '</summary><div class="kids">' +
              n.kids.map(node).join("") + "</div></details>";
          }
          $("a-form").innerHTML = TREE.root.kids.map(node).join("");
          renderKartTabs();
          renderSaveState();
        }
        function renderSaveState() {
          $("a-savebar").hidden = !isDirty(state.kartAtivo);
          document.querySelectorAll("#a-karts button").forEach(function (b) {
            b.classList.toggle("dirty", isDirty(b.getAttribute("data-akart")));
          });
          if (api.onChange) api.onChange();
        }

        /* ---------- Salvar / Descartar / Redefinir ---------- */
        function saveAcerto() {
          var k = state.kartAtivo;
          if (!isDirty(k)) { delete state.pending[k]; renderSaveState(); return; }
          var novo = cleanAcerto(state.pending[k]);
          var muds = diffAcerto(state.drafts[k], novo);
          var redef = !!resetFlag[k] && diffAcerto(acertoPadrao(), novo).length === 0;
          state.acertoLog.push({
            id: uid(),
            ts: nowIso(),
            kart: k,
            tipo: state.origemPendente[k] ? "importado" : redef ? "redefinir" : "alteracao",
            arquivo: state.origemPendente[k] || null,
            mudancas: muds,
            acerto: novo,
          });
          state.drafts[k] = cleanAcerto(novo);
          delete state.pending[k];
          delete state.origemPendente[k];
          delete resetFlag[k];
          persist();
          avisarNuvem();
          renderAcerto();
          renderLog();
          toast("Acerto salvo (" + muds.length + " alteração" + (muds.length > 1 ? "ões" : "") + ").");
        }
        function discardAcerto() {
          var k = state.kartAtivo;
          delete state.pending[k];
          delete state.origemPendente[k];
          delete resetFlag[k];
          persist();
          renderAcerto();
          toast("Alterações descartadas.");
        }
        function onReset() {
          var k = state.kartAtivo;
          state.pending[k] = acertoPadrao();
          delete state.origemPendente[k];
          resetFlag[k] = true;
          if (!isDirty(k)) {
            delete state.pending[k];
            toast("O acerto já está no padrão.");
          } else {
            toast("Valores padrão carregados. Toque em Salvar para gravar.");
          }
          persist();
          renderAcerto();
        }

        /* ---------- importar acerto (.md) ----------
           Cada linha é localizada pelo caminho na hierarquia do modelo, não pela posição.
           Assim funcionam também arquivos antigos, com campos a menos ou notas repetidas. */
        function normLabel(s) {
          return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
            .replace(/\s+/g, " ").trim().replace(/:$/, "").trim();
        }
        var MD_INDEX = (function () {
          var campos = {}, grupos = {}, heads = [], grp = null;
          MODELO.forEach(function (l) {
            if (l.t === "line") {
              var m = /^(#{1,3}) (.*)$/.exec(l.text);
              if (m) {
                heads = heads.slice(0, m[1].length - 1);
                heads[m[1].length - 1] = normLabel(m[2]);
                grp = null;
              } else if (/^- /.test(l.text)) {
                grp = normLabel(l.text.slice(2));
                grupos[heads.join("|") + "|" + grp] = true;
              }
            } else if (l.t === "field") {
              if (!l.indent) grp = null;
              campos[heads.join("|") + "|" + (l.indent ? grp + "|" : "") + normLabel(l.label)] = l;
            }
          });
          return { campos: campos, grupos: grupos };
        })();
        function parseAcertoMd(text) {
          var acerto = {}, lidos = {}, estranhas = [], heads = [], grp = null;
          CAMPOS.forEach(function (f) { acerto[f.key] = null; });
          String(text).replace(/^\uFEFF/, "").split(/\r?\n/).forEach(function (raw) {
            if (!raw.trim() || /^\s*>/.test(raw)) return;
            var h = /^\s*(#{1,6})\s+(.*)$/.exec(raw);
            if (h) {
              heads = heads.slice(0, h[1].length - 1);
              heads[h[1].length - 1] = normLabel(h[2]);
              grp = null;
              return;
            }
            var m = /^(\s*)(?:[-*+]\s+)?(.*)$/.exec(raw);
            var recuado = m[1].length > 0, corpo = m[2], i = corpo.indexOf(":");
            var label = normLabel(i < 0 ? corpo : corpo.slice(0, i));
            var valor = i < 0 ? "" : corpo.slice(i + 1).trim();
            var sec = heads.join("|") + "|", f;
            if (recuado) {
              f = grp ? MD_INDEX.campos[sec + grp + "|" + label] : null;
            } else {
              f = MD_INDEX.campos[sec + label];
              if (f) grp = null;
              else if (MD_INDEX.grupos[sec + label] && !valor) { grp = label; return; }
            }
            if (!f) { estranhas.push(raw.trim()); return; }
            if (f.tipo !== "texto" && /^(on|off)$/i.test(valor)) valor = valor.toUpperCase();
            if (f.tipo === "onoff" && valor && valor !== "ON" && valor !== "OFF") estranhas.push(raw.trim());
            acerto[f.key] = valor || null;
            lidos[f.key] = true;
          });
          return {
            acerto: acerto,
            nLidos: Object.keys(lidos).length,
            faltando: CAMPOS.filter(function (f) { return !lidos[f.key]; }).map(function (f) { return TREE.paths[f.key]; }),
            estranhas: estranhas,
          };
        }
        // "Acerto - 2026_11_21 - Praga.md" -> kart Praga
        function detectKart(nome) {
          var partes = String(nome).replace(/\.[^.]+$/, "").split(" - ");
          var fim = normLabel(partes[partes.length - 1]);
          var k = KARTS.filter(function (x) { return normLabel(x.arquivo) === fim; })[0];
          return k ? k.id : state.kartAtivo;
        }
        function onAcertoFile(file) {
          $("a-imp-msg").textContent = "";
          var fr = new FileReader();
          fr.onerror = function () { $("a-imp-msg").textContent = "Não foi possível ler o arquivo."; };
          fr.onload = function () {
            var r = parseAcertoMd(fr.result);
            if (!r.nLidos) {
              impPend = null;
              $("a-imp").hidden = true;
              $("a-imp-msg").textContent = "Este arquivo não segue o modelo de acerto.";
              return;
            }
            r.nome = file.name;
            r.kart = detectKart(file.name);
            impPend = r;
            renderImp();
          };
          fr.readAsText(file, "utf-8");
        }
        function renderImp() {
          var r = impPend, k = r.kart;
          var n = diffAcerto(state.drafts[k], r.acerto).length;
          var html = '<p class="imp-nome">' + esc(r.nome) + "</p>" +
            "<p>" + r.nLidos + " de " + CAMPOS.length + " campos lidos. " +
            (n ? n + " diferente" + (n > 1 ? "s" : "") + " do acerto salvo deste kart." : "Igual ao acerto salvo deste kart.") + "</p>";
          if (r.faltando.length) html += '<p class="imp-av">Não constam no arquivo e ficarão vazios: ' + esc(r.faltando.join("; ")) + ".</p>";
          if (r.estranhas.length) html += '<p class="imp-av">Linhas para conferir: ' + esc(r.estranhas.join("; ")) + ".</p>";
          if (isDirty(k)) html += '<p class="imp-av">As alterações não salvas deste kart serão substituídas.</p>';
          $("a-imp-info").innerHTML = html;
          $("a-imp-karts").innerHTML = KARTS.map(function (x) {
            return '<button type="button" data-impkart="' + esc(x.id) + '" aria-pressed="' + (x.id === k ? "true" : "false") + '">' + esc(x.nome) + "</button>";
          }).join("");
          $("a-imp").hidden = false;
        }
        function applyAcertoImport() {
          if (!impPend) return;
          var r = impPend, k = r.kart;
          impPend = null;
          $("a-imp").hidden = true;
          state.kartAtivo = k;
          delete resetFlag[k];
          state.pending[k] = cleanAcerto(r.acerto);
          state.origemPendente[k] = r.nome;
          var mudou = isDirty(k);
          if (!mudou) {
            delete state.pending[k];
            delete state.origemPendente[k];
          }
          persist();
          renderAcerto();
          renderLog();
          toast(mudou ? "Acerto carregado. Confira e toque em Salvar." : "O acerto salvo já é igual a este arquivo.");
        }

        /* ---------- log do acerto ---------- */
        function renderLog() {
          var k = state.kartAtivo;
          $("a-log-title").textContent = "Alterações · " + kartNome(k);
          var list = logSorted(k);
          if (!list.length) {
            $("a-log").innerHTML = '<p class="empty">Nenhuma alteração salva ainda.</p>';
            return;
          }
          function val(v) { return v == null || v === "" ? "vazio" : v; }
          $("a-log").innerHTML = '<ul class="slist">' + list.map(function (e) {
            var ch = e.mudancas.map(function (m) {
              return '<span class="log-ch">' + esc(TREE.paths[m.key] || m.key) + ": <s>" + esc(val(m.de)) + "</s> → <b>" + esc(val(m.para)) + "</b></span>";
            }).join("");
            return '<li class="srow"><div class="sinfo"><span class="sname">' + fmtDateTime(e.ts) +
              (e.tipo === "redefinir" ? '<span class="log-tag">Redefinido</span>' : "") +
              (e.tipo === "importado" ? '<span class="log-tag">Importado</span>' : "") + "</span>" +
              (e.arquivo ? '<span class="smeta">' + esc(e.arquivo) + "</span>" : "") + ch + "</div>" +
              '<div class="sctl"><button type="button" class="ghost" data-log-md="' + esc(e.id) + '">.md</button></div></li>';
          }).join("") + "</ul>";
        }

        
  function bind() {
    $("a-karts").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-akart]");
      if (!b) return;
      state.kartAtivo = b.getAttribute("data-akart");
      persist();
      renderAcerto();
      renderLog();
    });
    $("a-form").addEventListener("input", function (e) {
      var k = e.target.getAttribute && e.target.getAttribute("data-key");
      if (!k) return;
      var v = e.target.value;
      workAcerto()[k] = v.trim() === "" ? null : v;
      var box = e.target.closest(".onoff");
      if (box) box.querySelectorAll("button[data-val]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      afterAcertoInput();
    });
    $("a-form").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-onoff]");
      if (!b) return;
      var k = b.getAttribute("data-onoff"), v = b.getAttribute("data-val");
      var a = workAcerto();
      a[k] = a[k] === v ? null : v;
      b.parentNode.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-pressed", a[k] === x.getAttribute("data-val") ? "true" : "false");
      });
      var txt = b.closest(".onoff").querySelector("input[data-key]");
      if (txt) txt.value = "";
      afterAcertoInput();
    });
    $("a-form").addEventListener("toggle", function (e) {
      var p = e.target.getAttribute && e.target.getAttribute("data-path");
      if (p) openSet[p] = e.target.open;
    }, true);
    $("a-save").addEventListener("click", saveAcerto);
    $("a-discard").addEventListener("click", discardAcerto);
    $("a-reset").addEventListener("click", onReset);
    $("a-import").addEventListener("click", function () { $("a-file").click(); });
    $("a-file").addEventListener("change", function () {
      if (this.files && this.files[0]) onAcertoFile(this.files[0]);
      this.value = "";
    });
    $("a-imp-karts").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-impkart]");
      if (!b || !impPend) return;
      impPend.kart = b.getAttribute("data-impkart");
      renderImp();
    });
    $("a-imp-ok").addEventListener("click", applyAcertoImport);
    $("a-imp-cancel").addEventListener("click", function () { impPend = null; $("a-imp").hidden = true; });
    $("a-log").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-log-md]");
      if (!b) return;
      var en = state.acertoLog.filter(function (x) { return x.id === b.getAttribute("data-log-md"); })[0];
      if (en) download(mdName(en.kart, en.ts), acertoMd(en.acerto), "text/markdown;charset=utf-8");
    });
  }
  function renderTudo() { renderAcerto(); renderLog(); }
  function avisarNuvem() { if (window.KartSync) window.KartSync.changed(); }

  /* ---------- usado pela aba Pneus e pelo backup ---------- */
  api.KARTS = KARTS;
  api.kartNome = kartNome;
  api.nowIso = nowIso;
  api.toLocalInput = toLocalInput;
  api.localInputToIso = localInputToIso;
  api.fmtDateTime = fmtDateTime;
  api.fmtDia = fmtDia;
  api.hoje = hoje;
  api.mdName = mdName;
  api.md = acertoMd;
  api.limpar = function (a) { return a && typeof a === "object" ? cleanAcerto(a) : null; };
  api.salvo = function (k) { return state.drafts[k] ? cleanAcerto(state.drafts[k]) : null; };
  api.temPendencia = isDirty;
  // Acerto que valia naquele momento, para quando o kart é informado depois.
  api.acertoEm = function (k, iso) {
    var lista = logSorted(k), t = new Date(iso);
    var e = lista.filter(function (x) { return new Date(x.ts) <= t; })[0];
    return e ? cleanAcerto(e.acerto) : null;
  };
  api.backup = function () {
    return { acertos_salvos: state.drafts, acerto_log: logSorted().reverse() };
  };
  api.ler = function (x) {
    x = x || {};
    return {
      salvos: x.acertos_salvos || {},
      log: (Array.isArray(x.acerto_log) ? x.acerto_log : []).map(cleanLogEntry).filter(Boolean),
    };
  };
  api.mesclar = function (x) {
    var map = {};
    state.acertoLog.forEach(function (e) { map[e.id] = e; });
    x.log.forEach(function (e) { map[e.id] = e; });
    state.acertoLog = Object.keys(map).map(function (k) { return map[k]; });
    KARTS.forEach(function (k) {
      var last = logSorted(k.id)[0], salvo = x.salvos[k.id];
      if (last) state.drafts[k.id] = cleanAcerto(last.acerto);
      else if (salvo && !diffAcerto(acertoPadrao(), state.drafts[k.id]).length) state.drafts[k.id] = cleanAcerto(salvo, acertoPadrao());
    });
    persist();
    avisarNuvem();
    renderTudo();
  };
  api.substituir = function (x) {
    state.acertoLog = x.log.slice();
    state.pending = {};
    state.origemPendente = {};
    KARTS.forEach(function (k) {
      var last = logSorted(k.id)[0], salvo = x.salvos[k.id];
      state.drafts[k.id] = last ? cleanAcerto(last.acerto) : salvo ? cleanAcerto(salvo, acertoPadrao()) : acertoPadrao();
    });
    persist();
    avisarNuvem();
    renderTudo();
  };
  api.temDados = function () {
    return state.acertoLog.length > 0 || KARTS.some(function (k) {
      return diffAcerto(acertoPadrao(), state.drafts[k.id]).length > 0;
    });
  };
  // Acerto ainda no padrão e sem histórico não vai para a nuvem: um aparelho novo
  // não pode sobrescrever o acerto real de outro aparelho com os valores padrão.
  api.dadosSync = function () {
    var salvos = {};
    KARTS.forEach(function (k) {
      if (logSorted(k.id).length || diffAcerto(acertoPadrao(), state.drafts[k.id]).length) salvos[k.id] = state.drafts[k.id];
    });
    return { log: state.acertoLog, salvos: salvos };
  };
  // Alterações vindas de outro aparelho. O que está sendo digitado (pendente) não é tocado.
  api.aplicarSync = function (lista) {
    lista.forEach(function (c) {
      if (c.col === "acertoLog") {
        state.acertoLog = state.acertoLog.filter(function (e) { return e.id !== c.id; });
        if (!c.deleted) {
          var e = cleanLogEntry(c.data);
          if (e) state.acertoLog.push(e);
        }
      } else if (c.col === "acertoSalvo" && !c.deleted && isKart(c.id)) {
        state.drafts[c.id] = cleanAcerto(c.data, acertoPadrao());
      }
    });
    // com alterações feitas em aparelhos diferentes, vale o Salvar mais recente
    KARTS.forEach(function (k) {
      var last = logSorted(k.id)[0];
      if (last) state.drafts[k.id] = cleanAcerto(last.acerto);
    });
    persist();
    renderLog();
    if (!$("a-form").contains(document.activeElement)) renderAcerto();
    else renderSaveState();
  };

  window.KartAcerto = api;
  load();
  renderTudo();
  bind();
})();
