/* Modelo do acerto: espelha, linha por linha, o arquivo "Acerto - YYYY_MM_DD - Kart.md".
   Esta lista é a ÚNICA fonte da tela de Acerto e do .md exportado.
   Se o modelo mudar, altere só aqui.

   Tipos de linha:
     L("texto")                       -> linha fixa, copiada como está (títulos, notas, grupos)
     B                                -> linha em branco
     F(chave, rótulo, recuo, padrão)  -> campo:  "<recuo>- Rótulo: valor"
     F(..., { semMarcador: true })    -> campo sem "- " no início:  "Rótulo: valor"
     F(..., { tipo: "onoff" })        -> campo com botão ON / OFF em vez de texto (vazio se nenhum marcado)
     F(..., { tipo: "onoff-texto" })  -> botão ON / OFF e também um campo de texto (ex.: "Nylon")

   A chave identifica o campo nos dados salvos. Não mude a chave de um campo
   já usado, senão os registros antigos perdem esse valor (mude só o rótulo). */
(function () {
  "use strict";
  function L(text) { return { t: "line", text: text }; }
  var B = { t: "blank" };
  function F(key, label, indent, def, opts) {
    return {
      t: "field",
      key: key,
      label: label,
      indent: indent || 0,
      def: def == null ? "" : def,
      bullet: !(opts && opts.semMarcador),
      tipo: (opts && opts.tipo) || "texto",
    };
  }

  /* Karts (sub-abas do Acerto). Cada kart tem o seu acerto e o seu log.
     Não mude o "id" de um kart já usado; o "nome" pode mudar à vontade.
     "arquivo" é o nome usado no .md exportado: "Acerto - AAAA_MM_DD - Praga.md". */
  window.KARTS = [
    { id: "praga-2026", nome: "Praga 2026 (#95)", arquivo: "Praga" },
    { id: "mega-2011", nome: "Mega 2011 (#95)", arquivo: "MEGA" },
  ];

  window.ACERTO_MODELO = [
    L("# Chassi"),
    B,
    L("> Obs: ON = Instalado - OFF = Não instalado"),
    B,
    F("chassi.barra_torcao", "Barra de torção", 0, "", { tipo: "onoff-texto" }),
    B,
    L("## Geometria de direção"),
    B,
    F("geometria.rodas", "Rodas"),
    B,
    L("### Dianteira"),
    B,
    L("- Direita:"),
    F("dianteira.direita.camber", "Cambagem (Camber)", 2),
    F("dianteira.direita.toe", "Convergência (TOE)", 2),
    F("dianteira.direita.caster", "Caster", 2),
    F("dianteira.direita.bitola", "Bitola", 2),
    L("- Esquerda:"),
    F("dianteira.esquerda.camber", "Cambagem (Camber)", 2),
    F("dianteira.esquerda.toe", "Convergência (TOE)", 2),
    F("dianteira.esquerda.caster", "Caster", 2),
    F("dianteira.esquerda.bitola", "Bitola", 2),
    F("dianteira.ackermann", "Ackermann"),
    B,
    L("### Traseira"),
    B,
    F("traseira.bitola", "Bitola"),
    F("traseira.eixo", "Eixo"),
    B,
    L("## Banco"),
    B,
    F("banco.inclinacao", "Inclinação", 0, "~30°"),
    L("- Orelha esquerda:"),
    F("banco.orelha_esquerda.horizontal", "Horizontal", 2, "~68cm (Até a base do pedal)"),
    F("banco.orelha_esquerda.vertical", "Vertical", 2, "~14cm (Até o assoalho)"),
    L("- Orelha direita:"),
    F("banco.orelha_direita.horizontal", "Horizontal", 2, "~70cm (Até a base do pedal)"),
    F("banco.orelha_direita.vertical", "Vertical", 2, "~14cm (Até o assoalho)"),
    L("- Centro superior (costas):"),
    F("banco.centro_superior.horizontal", "Horizontal", 2, "~70cm (Até o tanque)"),
    F("banco.centro_superior.vertical", "Vertical", 2, "~21,5cm (Até o eixo)"),
    L("- Base (fundo)"),
    F("banco.base.horizontal", "Horizontal", 2, "~0cm (Alinhado com o chassi)"),
    B,
    L('> Para mais informações, verificar: _"Estudo banco.pdf"_'),
    B,
    L("## Lastro:"),
    B,
    F("lastro.conjunto_1", "Conjunto 1", 0, "", { tipo: "onoff" }),
    F("lastro.conjunto_2", "Conjunto 2", 0, "", { tipo: "onoff" }),
    F("lastro.conjunto_3", "Conjunto 3", 0, "", { tipo: "onoff" }),
    F("lastro.conjunto_4", "Conjunto 4", 0, "", { tipo: "onoff" }),
    F("lastro.conjunto_5", "Conjunto 5", 0, "", { tipo: "onoff" }),
    B,
    L("# Motor"),
    B,
    F("motor.id", "ID", 0, "Honda GX390 (01)", { semMarcador: true }),
    B,
    F("motor.carburador", "Carburador"),
    F("motor.cachimbo", "Cachimbo"),
    F("motor.vela", "Vela"),
    F("motor.gasolina", "Gasolina"),
    F("motor.coroa", "Coroa"),
  ];
})();
