/* Inventário Escolar: interface. */
(function () {
  'use strict';
  var I = window.INV, $ = function (s) { return document.querySelector(s); };
  var view = 'painel';
  var cad = null;            // formulário de cadastro em andamento
  var ultimoCarrinho = '';
  var recentes = [];         // últimos salvos nesta sessão
  var eqFiltro = { q: '', c: '', t: '', max: 60 };
  var cfFiltro = { sit: 'abertos', tipo: '', grupo: '', eqTipo: '', aba: 'casos', max: 40 };
  var pnTipo = '';           // filtro por tipo no painel
  var ultimoTipo = 'Chromebook';
  var imp = null;            // importação em andamento

  /* ---------- utilidades de tela ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag), i, k;
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { attrs = null; i = 1; } else i = 2;
    if (attrs) for (k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'value') e.value = attrs[k];
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e) {
    for (var k = 1; k < arguments.length; k++) {
      var c = arguments[k];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { add(e, x); });
      else e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  function fmtData(ts) { return ts ? new Date(ts).toLocaleDateString('pt-BR') : ''; }
  function fmtPct(a, b) { return b ? Math.round(100 * a / b) + '%' : '—'; }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function abrirDlg(conteudo) {
    var d = $('#dlg'), box = $('#dlg-in');
    box.textContent = ''; add(box, conteudo);
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function fecharDlg() { var d = $('#dlg'); if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }
  function dlgTopo(titulo) { return h('div', { class: 'dlg-h' }, h('h2', titulo), h('button', { class: 'x', 'aria-label': 'Fechar', onclick: fecharDlg }, '×')); }
  function baixar(nome, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function ir(v) { view = v; render(); window.scrollTo(0, 0); }
  function badgeUso(e) {
    var u = I.uso(e);
    return h('span', { class: 'badge ' + (u === 'fora' ? 'b-bad' : u === 'ressalva' ? 'b-warn' : 'b-ok') }, u === 'fora' ? 'Fora de uso' : u === 'ressalva' ? 'Usável, com defeito' : 'Usável');
  }
  function temSistema() { return I.S.sistema.itens.length > 0; }

  /* ---------- leitor de código de barras ---------- */
  var stream = null, rodando = false;
  function fecharScan() { rodando = false; if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } $('#scan').hidden = true; }
  function suportaScan() { return 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia; }
  function abrirScan(cb) {
    var det; try { det = new BarcodeDetector(); } catch (e) { return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      stream = s; rodando = true;
      var v = $('#video'); v.srcObject = s; v.play(); $('#scan').hidden = false;
      (function volta() {
        if (!rodando) return;
        det.detect(v).then(function (codes) {
          if (codes && codes.length) { var val = codes[0].rawValue; fecharScan(); cb(val); } else setTimeout(volta, 250);
        }).catch(function () { setTimeout(volta, 400); });
      })();
    }).catch(function () { toast('Não consegui abrir a câmera. Confira a permissão do navegador.'); });
  }
  $('#scan-close').addEventListener('click', fecharScan);

  /* ---------- cabeçalho ---------- */
  function cabecalho() {
    var S = I.S;
    $('#escola-nome').textContent = S.meta.escola || 'Sem nome da escola';
    var p = $('#pill-backup');
    if (!S.equipamentos.length) { p.hidden = true; }
    else {
      var dias = S.meta.ultimoBackup ? Math.floor((Date.now() - S.meta.ultimoBackup) / 86400000) : null;
      p.hidden = false;
      if (dias === null) { p.className = 'pill'; p.textContent = 'Sem backup'; }
      else if (dias >= 7) { p.className = 'pill'; p.textContent = 'Backup há ' + dias + ' dias'; }
      else { p.className = 'pill ok'; p.textContent = dias === 0 ? 'Backup de hoje' : 'Backup há ' + dias + ' dia' + (dias > 1 ? 's' : ''); }
      p.onclick = function () { ir('mais'); };
    }
    var abertos = temSistema() ? I.resumo().abertos : 0, d = $('#dot-casos');
    d.hidden = !abertos; d.textContent = abertos > 99 ? '99+' : abertos;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === view); });
  }

  /* ---------- PAINEL ---------- */
  var GRUPOS = {
    sistema: ['Atualizar a localização no sistema', 'O N/S existe, mas está cadastrado em outro lugar. É só mudar o local lá.'],
    etiqueta: ['Conferir a etiqueta do aparelho', 'Provável erro de digitação, N/S que o sistema não tem ou registro repetido.'],
    procurar: ['Procurar ou cadastrar', 'Está no sistema, mas ainda não foi cadastrado aqui.']
  };
  function fmtN(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function vPainel() {
    var S = I.S, root = h('div', { class: 'view' });
    var feitos = [!!S.meta.escola, temSistema(), S.carrinhos.length > 0 && S.carrinhos.every(function (c) { return I.locaisDe(c).length; }), S.equipamentos.length > 0];
    var inicio = !(feitos[1] && feitos[3]);
    var tem = temSistema();
    var head = h('div', null, h('h1', S.meta.escola || 'Bem-vindo'), h('p', { class: 'muted' }, S.equipamentos.length ? 'Visão geral do inventário, conferido com o sistema.' : 'Vamos montar o inventário da sua escola.'));
    add(root, head);

    if (inicio) {
      add(root, h('div', { class: 'card' }, h('h2', 'Primeiros passos'),
        h('div', { class: 'steps' },
          passo(feitos[0], 'Dê um nome à escola', 'Aparece no topo e nas planilhas que você exportar.', 'Abrir configurações', function () { ir('mais'); }),
          passo(feitos[1], 'Importe a lista do sistema', 'É a planilha que a Secretaria exporta com os equipamentos da escola.', 'Importar', function () { ir('importar'); }),
          passo(feitos[2], 'Ligue cada carrinho ou local ao nome que o sistema usa', 'Assim o aplicativo confere o local e conta os equipamentos de cada lugar.', 'Ver carrinhos e locais', function () { ir('mais'); }),
          passo(feitos[3], 'Cadastre os equipamentos', 'Digite ou leia o código de barras. Ou importe a sua planilha de inventário.', 'Cadastrar', function () { ir('cadastrar'); }))));
    }
    if (!S.equipamentos.length) return root;

    var todos = I.resumo(), tiposUsados = todos.porTipo;
    if (pnTipo && !tiposUsados.some(function (t) { return t.tipo === pnTipo; })) pnTipo = '';
    var r = pnTipo ? I.resumo(pnTipo) : todos;
    var filtroTxt = pnTipo ? ' (' + pnTipo + ')' : '';

    // frase-resumo
    var take = h('p', { class: 'take' });
    if (tem) {
      add(take, h('b', fmtN(r.total)), ' equipamentos cadastrados de ', h('b', fmtN(r.sisTotal)), ' no sistema' + filtroTxt + '. ');
      var div = r.grupos.sistema + r.grupos.etiqueta;
      if (div) add(take, h('b', fmtN(div)), div === 1 ? ' divergência para resolver: ' : ' divergências para resolver: ', h('b', r.grupos.sistema), ' pedem só uma mudança de local no sistema e ', h('b', r.grupos.etiqueta), ' pedem para olhar a etiqueta. ');
      else add(take, 'Tudo que foi cadastrado confere com o sistema. ');
      if (r.grupos.procurar) add(take, h('b', fmtN(r.grupos.procurar)), r.grupos.procurar === 1 ? ' equipamento está no sistema, mas ainda não foi cadastrado aqui.' : ' equipamentos estão no sistema, mas ainda não foram cadastrados aqui.');
    } else add(take, h('b', fmtN(r.total)), ' equipamentos cadastrados. Importe a lista do sistema para conferir.');
    add(head, take);

    add(root, h('div', { class: 'kpis' },
      kpi(fmtN(r.total), 'cadastrados', tem ? 'de ' + fmtN(r.sisTotal) + ' no sistema' : ''),
      tem ? kpi(fmtPct(r.confere, r.total), 'conferem com o sistema', r.confere + ' de ' + r.total) : null,
      tem ? kpi(fmtN(r.grupos.sistema + r.grupos.etiqueta), 'divergências com o sistema', r.resolvidos + ' resolvidas') : null,
      tem ? kpi(fmtN(Math.max(0, r.sisTotal - r.sisConferidos)), 'faltam cadastrar', 'estão no sistema, mas não aqui') : null,
      kpi(fmtN(r.ok + r.ressalva), 'usáveis', r.ressalva ? r.ressalva + ' com defeito' : ''),
      kpi(fmtN(r.fora), 'fora de uso', r.semSn ? r.semSn + ' sem N/S' : '')));
    if (!tem) add(root, h('div', { class: 'note n-info' }, h('b', 'Falta a lista do sistema'), h('p', 'Importe a planilha do sistema para o aplicativo conferir N/S e local.'), h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: function () { ir('importar'); } }, 'Importar agora'))));

    // por tipo
    if (tiposUsados.length > 1) {
      var gt = h('div', { class: 'tipos' });
      tiposUsados.forEach(function (t) {
        var pct = t.cad ? 100 * t.confere / t.cad : 0;
        add(gt, h('button', { class: 'grp', type: 'button', 'aria-pressed': pnTipo === t.tipo ? 'true' : 'false', onclick: function () { pnTipo = pnTipo === t.tipo ? '' : t.tipo; render(); } },
          h('span', { class: 'v' }, fmtN(t.cad), tem && t.sis ? h('small', { class: 'muted', style: 'font-size:.9rem;font-family:inherit' }, ' / ' + fmtN(t.sis)) : null),
          h('span', { class: 'h' }, t.tipo),
          h('span', { class: 'd' }, tem ? t.confere + ' conferem' + (t.casos ? ' · ' + t.casos + ' caso' + (t.casos > 1 ? 's' : '') : '') : 'cadastrados'),
          tem ? h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { class: 'a', style: 'width:' + pct + '%' })) : null));
      });
      add(root, h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', 'Por tipo de equipamento'), h('span', { class: 'muted', style: 'font-size:.82rem' }, 'Toque em um tipo para filtrar o painel' + (tem ? ' · cadastrados / no sistema' : ''))), gt));
    }

    // gráficos por carrinho ou local
    var linhas = r.porCarrinho;
    if (linhas.length) {
      var maxv = 1; linhas.forEach(function (c) { maxv = Math.max(maxv, c.total + c.falta); });
      function barras(partes, dados, so) {
        var box = h('div');
        linhas.forEach(function (c) {
          if (so && !partes.reduce(function (a, p) { return a + dados(c, p.k); }, 0)) return;
          var segs = partes.map(function (p) { var v = dados(c, p.k); return v ? h('i', { class: p.c, style: 'width:' + (100 * v / maxv) + '%', title: p.l + ': ' + v }) : null; });
          var tot = partes.reduce(function (a, p) { return a + dados(c, p.k); }, 0);
          add(box, h('div', { class: 'srow' }, h('span', { class: 'nm', title: c.nome }, c.nome), h('div', { class: 'sbar', 'aria-hidden': 'true' }, segs), h('span', { class: 'tt' }, tot)));
        });
        return box;
      }
      function leg(partes) { return h('div', { class: 'legend' }, partes.map(function (p) { return h('span', null, h('i', { class: p.c }), p.l); })); }
      var p1 = [{ k: 'confere', l: 'Confere', c: 'c-ok' }, { k: 'local', l: 'Local diferente', c: 'c-local' }, { k: 'parecido', l: 'Provável erro de digitação', c: 'c-prov' }, { k: 'sem', l: 'Não está no sistema', c: 'c-bad' }, { k: 'semsn', l: 'Sem N/S', c: 'c-sn' }, { k: 'falta', l: 'No sistema, falta cadastrar', c: 'c-falta' }];
      var p2 = [{ k: 'ok', l: 'Usável', c: 'c-uok' }, { k: 'ressalva', l: 'Usável, com defeito', c: 'c-uress' }, { k: 'fora', l: 'Fora de uso', c: 'c-ufora' }];
      add(root, h('div', { class: 'grid g2' },
        tem ? h('div', { class: 'card' }, h('h2', 'O que o sistema diz de cada carrinho e local' + filtroTxt), h('p', { class: 'muted', style: 'font-size:.88rem' }, 'Cada equipamento cadastrado, comparado com o sistema.'), leg(p1), barras(p1, function (c, k) { return k === 'falta' ? c.falta : c[k]; })) : null,
        h('div', { class: 'card' }, h('h2', 'Estado de uso de cada carrinho e local' + filtroTxt), h('p', { class: 'muted', style: 'font-size:.88rem' }, 'Pelo que foi anotado nos defeitos.'), leg(p2), barras(p2, function (c, k) { return c[k]; }, true))));
    }

    // plano de resolução
    if (tem) {
      if (r.abertos) {
        var plano = h('div', { class: 'plano' });
        ['sistema', 'etiqueta', 'procurar'].forEach(function (g) {
          add(plano, h('button', { class: 'grp', type: 'button', onclick: function () { cfFiltro.grupo = g; cfFiltro.eqTipo = pnTipo; cfFiltro.sit = 'abertos'; cfFiltro.tipo = ''; cfFiltro.aba = 'casos'; cfFiltro.max = 40; ir('conferir'); } },
            h('span', { class: 'v' }, r.grupos[g]), h('span', { class: 'h' }, GRUPOS[g][0]), h('span', { class: 'd' }, GRUPOS[g][1]),
            h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { class: g === 'sistema' ? 'a' : g === 'etiqueta' ? 'b' : 'c', style: 'width:' + (100 * r.grupos[g] / (r.abertos || 1)) + '%' }))));
        });
        add(root, h('div', { class: 'card' }, h('h2', 'Plano de resolução'), h('p', { class: 'muted', style: 'font-size:.88rem' }, 'Toque em um grupo para ver os casos.'), plano));
      }
      // quantidades
      var qs = I.quantidades(pnTipo).filter(function (q) { return q.sis !== 0 || q.cad; });
      if (qs.length) {
        var tb = h('table', null, h('thead', null, h('tr', null, h('th', 'Carrinho ou local'), h('th', 'Tipo'), h('th', { class: 'num' }, 'No sistema'), h('th', { class: 'num' }, 'Cadastrados'), h('th', { class: 'num' }, 'Diferença'), h('th', { class: 'num' }, 'Sem N/S'))),
          h('tbody', null, qs.map(function (q) {
            var d = q.sis == null ? null : q.cad - q.sis;
            return h('tr', null, h('td', q.nome), h('td', q.tipo), h('td', { class: 'num' }, q.sis == null ? 'sem ligação' : q.sis), h('td', { class: 'num' }, q.cad),
              h('td', { class: 'num ' + (d == null ? '' : d === 0 ? 'dif-0' : d > 0 ? 'dif-mais' : 'dif-menos') }, d == null ? '—' : d > 0 ? '+' + d : d), h('td', { class: 'num' }, q.semSn || ''));
          })));
        add(root, h('div', { class: 'card' }, h('h2', 'Contagem por carrinho, local e tipo' + filtroTxt),
          h('p', { class: 'muted', style: 'font-size:.88rem' }, 'Quantos o sistema diz que existem em cada lugar × quantos você cadastrou. Diferença negativa: faltam cadastrar. Serve também para o que não tem N/S legível.'), h('div', { class: 'tbox' }, tb)));
      }
      if (todos.semLigacao.length) {
        var itens = todos.semLigacao.reduce(function (a, l) { return a + l.n; }, 0);
        add(root, h('div', { class: 'note n-info' }, h('b', todos.semLigacao.length + ' locais do sistema sem ligação'), h('p', fmtN(itens) + ' equipamentos do sistema estão em locais que você ainda não criou aqui (por exemplo: ' + todos.semLigacao.slice(0, 3).map(function (l) { return l.nome.trim(); }).join('; ') + (todos.semLigacao.length > 3 ? '…' : '') + ').'),
          h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: function () { dlgLocaisNovos(); } }, 'Criar locais a partir do sistema'))));
      }
    }

    var at = I.atencao();
    if (at.length) add(root, h('div', { class: 'card' }, h('h2', 'Para atenção'), h('p', { class: 'muted' }, at.filter(function (a) { return a.tipo === 'Defeito'; }).length + ' defeitos anotados e ' + at.filter(function (a) { return a.tipo !== 'Defeito'; }).length + ' equipamentos sem patrimônio.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: function () { cfFiltro.aba = 'atencao'; ir('conferir'); } }, 'Ver lista'))));
    return root;
  }
  function dlgLocaisNovos() {
    var sug = I.sugerirLocaisNovos();
    if (!sug.length) { toast('Todos os locais do sistema já estão ligados.'); return; }
    var linhas = sug.map(function (g) {
      var ck = h('input', { type: 'checkbox', checked: true, style: 'width:20px;height:20px;accent-color:var(--brand);margin-top:6px' });
      var nm = h('input', { type: 'text', value: g.nome });
      return { g: g, ck: ck, nm: nm, el: h('div', { style: 'display:flex;gap:10px;align-items:flex-start;border-top:1px solid var(--line);padding:8px 0' }, ck,
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:3px;min-width:0' }, nm, h('span', { class: 'muted', style: 'font-size:.8rem' }, (g.tipo === 'carrinho' ? 'Carrinho' : 'Local') + ' · ' + g.n + ' itens · no sistema: ' + g.locais.map(function (l) { return l.trim(); }).join('; ')))) };
    });
    abrirDlg([dlgTopo('Criar locais a partir do sistema'),
      h('p', { class: 'muted', style: 'font-size:.9rem' }, 'O sistema usa estes nomes para os equipamentos que você ainda não ligou a nenhum lugar. Locais com o mesmo nome (como "Laboratório de Informática" para mini PCs e monitores) ficam juntos. Mude o nome ou desmarque o que não quiser.'),
      h('div', { style: 'max-height:55vh;overflow:auto' }, linhas.map(function (l) { return l.el; })),
      h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () {
        var n = 0;
        linhas.forEach(function (l) { if (l.ck.checked && I.txt(l.nm.value)) { I.criarLocal(I.txt(l.nm.value), l.g.tipo, l.g.locais); n++; } });
        fecharDlg(); toast(n + (n === 1 ? ' local criado.' : ' locais criados.')); render();
      } }, 'Criar selecionados'), h('button', { class: 'btn', onclick: fecharDlg }, 'Cancelar'))]);
  }
  function passo(feito, titulo, desc, botao, fn) {
    return h('div', { class: 'step' + (feito ? ' done' : '') }, h('div', null, h('b', titulo), h('span', { class: 'muted', style: 'font-size:.9rem' }, desc),
      feito ? null : h('div', { class: 'btns', style: 'margin-top:6px' }, h('button', { class: 'btn sm pri', onclick: fn }, botao))));
  }
  function kpi(v, l, sub) { return h('div', { class: 'kpi' }, h('span', { class: 'v' }, v), h('span', { class: 'l' }, l), sub ? h('span', { class: 'l' }, sub) : null); }

  /* ---------- CADASTRAR ---------- */
  function numSug(id) { var c = I.carrinho(id); return c && (c.tipo || 'carrinho') === 'carrinho' ? String(I.proximoNumero(id)) : ''; }
  function novoForm(base) {
    return { id: '', sn: '', semSn: false, patrimonio: '', carrinho: ultimoCarrinho, numero: '', modelo: '', modeloAuto: true, tipo: ultimoTipo, tipoAuto: true, defeitos: [], obs: '' };
  }
  function carregarEdicao(e) {
    cad = { id: e.id, sn: e.sn || '', semSn: !I.norm(e.sn), patrimonio: e.patrimonio || '', carrinho: e.carrinho, numero: e.numero || '', modelo: e.modelo || '',
      modeloAuto: false, tipo: I.tipoDe(e), tipoAuto: false, defeitos: (e.defeitos || []).slice(), obs: e.obs || '' };
    ir('cadastrar');
  }
  function vCadastrar() {
    var S = I.S;
    if (!cad) { cad = novoForm(); if (cad.carrinho) cad.numero = numSug(cad.carrinho); }
    var root = h('div', { class: 'view' });
    var editando = !!cad.id;
    add(root, h('div', null, h('h1', editando ? 'Editar equipamento' : 'Cadastrar equipamento'), h('p', { class: 'muted' }, editando ? 'Mude o que for preciso e salve.' : 'Digite o N/S ou leia o código de barras. O aplicativo confere com o sistema na hora.')));
    var selT;

    var aviso = h('div'), inSn, inPat, selC, inNum, inMod, inObs, form;
    function mostrarAviso() {
      aviso.textContent = '';
      if (cad.semSn) { add(aviso, h('div', { class: 'note n-info' }, h('b', 'Sem N/S'), h('p', 'Este equipamento não será conferido pelo N/S, só pela contagem do local. Anote o patrimônio e o modelo para identificá-lo depois.'))); return; }
      var n = I.norm(cad.sn);
      if (n.length < 6) { if (cad.modeloAuto && inMod && cad.modelo && !I.modeloPara(cad.sn)) { cad.modelo = ''; inMod.value = ''; } return; }
      var outro = I.achaEq(cad.sn).filter(function (e) { return e.id !== cad.id; })[0];
      if (outro) add(aviso, h('div', { class: 'note n-warn' }, h('b', 'Já cadastrado'), h('p', 'Este N/S já está em ' + I.nomeCarrinho(outro.carrinho) + (outro.numero ? ', nº ' + outro.numero : '') + '.'),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn sm', onclick: function () { carregarEdicao(outro); } }, 'Editar esse cadastro'))));
      if (!temSistema()) { if (cad.modeloAuto) { cad.modelo = I.modeloPara(cad.sn); if (inMod) inMod.value = cad.modelo; } return; }
      var m = I.acharSistema(cad.sn), c = I.carrinho(cad.carrinho);
      if (m) {
        var it = m.item, difLoc = c && I.locaisDe(c).length && it.local && I.locaisDe(c).indexOf(it.local) < 0;
        if (cad.tipoAuto && it.categoria) { cad.tipo = it.categoria; if (selT) selT.value = cad.tipo; }
        add(aviso, h('div', { class: 'note ' + (difLoc ? 'n-warn' : 'n-ok') }, h('b', difLoc ? 'Está no sistema, mas em outro local' : 'Está no sistema'),
          h('p', [it.modelo || 'Sem modelo no sistema', it.local ? ' · local no sistema: ' + it.local : '', m.tipo === 'prefixo' ? ' · o cadastro do sistema está com o N/S incompleto (' + it.sn + ')' : ''].join('')),
          difLoc ? h('p', 'Você escolheu ' + c.nome + '. Vai aparecer em Conferir como "local diferente".') : null));
        if (cad.modeloAuto) { cad.modelo = I.modeloPara(cad.sn) || it.modelo || ''; if (inMod) inMod.value = cad.modelo; }
      } else {
        var melhor = null;
        S.sistema.itens.forEach(function (it2) {
          var d = levCurto(n, I.norm(it2.sn));
          if (d <= 2 && (!melhor || d < melhor.d)) melhor = { it: it2, d: d };
        });
        if (melhor) add(aviso, h('div', { class: 'note n-warn' }, h('b', 'Não está no sistema, mas tem um parecido'), h('p', 'O mais parecido é ' + melhor.it.sn + (melhor.it.local ? ' (' + melhor.it.local + ')' : '') + '. Confira a etiqueta.'),
          h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn sm', onclick: function () { cad.sn = melhor.it.sn; inSn.value = cad.sn; mostrarAviso(); } }, 'Usar ' + melhor.it.sn))));
        else add(aviso, h('div', { class: 'note n-bad' }, h('b', 'Não está no sistema'), h('p', 'Confira a etiqueta. Se estiver certo, o equipamento não foi cadastrado pela Secretaria.')));
        if (cad.modeloAuto) { cad.modelo = I.modeloPara(cad.sn); if (inMod) inMod.value = cad.modelo; }
      }
    }
    function levCurto(a, b) {
      if (Math.abs(a.length - b.length) > 2) return 3;
      var prev = [], cur, i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) { cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
      return prev[b.length];
    }

    inSn = h('input', { class: 'big mono', type: 'text', id: 'f-sn', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: 'N/S do equipamento', inputmode: 'text', value: cad.sn,
      oninput: function () { cad.sn = this.value; mostrarAviso(); } });
    var ckSem = h('label', { class: 'inl-check' }, h('input', { type: 'checkbox', checked: cad.semSn, onchange: function () {
      cad.semSn = this.checked; inSn.disabled = this.checked; if (this.checked) { cad.sn = ''; inSn.value = ''; } mostrarAviso(); } }), 'Não consegui ler o N/S (conta só por quantidade)');
    inSn.disabled = cad.semSn;
    var linhaSn = h('div', { class: 'row-inl' }, inSn,
      suportaScan() ? h('button', { type: 'button', class: 'btn', title: 'Ler código de barras', onclick: function () { abrirScan(function (v) { cad.sn = v; inSn.value = v; mostrarAviso(); }); } }, 'Câmera') : null);

    inPat = h('input', { type: 'text', inputmode: 'numeric', value: cad.patrimonio, placeholder: 'Ex.: 382780', oninput: function () { cad.patrimonio = this.value; } });
    selC = h('select', { onchange: function () {
      if (this.value === '__novo') { novoCarrinhoDlg(function (c) { cad.carrinho = c.id; cad.numero = numSug(c.id); ultimoCarrinho = c.id; render(); }); this.value = cad.carrinho; return; }
      cad.carrinho = this.value; ultimoCarrinho = this.value;
      if (!editando) { cad.numero = numSug(cad.carrinho); inNum.value = cad.numero; }
      mostrarAviso();
    } }, h('option', { value: '' }, 'Escolha o carrinho ou local'),
      S.carrinhos.map(function (c) { return h('option', { value: c.id }, c.nome + (c.tipo === 'local' ? ' (local)' : '')); }), h('option', { value: '__novo' }, '+ Novo carrinho ou local…'));
    selT = h('select', { onchange: function () { cad.tipo = this.value; cad.tipoAuto = false; ultimoTipo = this.value; } }, I.tipos().map(function (t) { return h('option', { value: t }, t); }));
    selT.value = cad.tipo;
    selC.value = cad.carrinho;
    inNum = h('input', { type: 'text', inputmode: 'numeric', value: cad.numero, oninput: function () { cad.numero = this.value; } });
    inMod = h('input', { type: 'text', value: cad.modelo, placeholder: 'Preenchido pelo N/S quando possível', oninput: function () { cad.modelo = this.value; cad.modeloAuto = !this.value; } });
    inObs = h('textarea', { placeholder: 'Ex.: caiu e a tela rachou; tecla A solta…', oninput: function () { cad.obs = this.value; } }); inObs.value = cad.obs;

    var defs = h('div', { class: 'defs' }, I.DEFEITOS.map(function (d) {
      return h('label', null, h('input', { type: 'checkbox', checked: cad.defeitos.indexOf(d.id) >= 0, onchange: function () {
        var i = cad.defeitos.indexOf(d.id); if (this.checked && i < 0) cad.defeitos.push(d.id); if (!this.checked && i >= 0) cad.defeitos.splice(i, 1); } }), d.nome);
    }));

    function salvar(ev) {
      ev.preventDefault();
      var sn = I.txt(cad.sn).replace(/\s+/g, '');
      if (cad.semSn) sn = '';
      if (!sn && !cad.semSn) { toast('Digite o número de série, ou marque que não conseguiu ler.'); inSn.focus(); return; }
      if (!cad.carrinho) { toast('Escolha o carrinho ou local.'); selC.focus(); return; }
      var outro = sn ? I.achaEq(sn).filter(function (e) { return e.id !== cad.id; })[0] : null;
      if (outro && !confirm('Este N/S já está cadastrado em ' + I.nomeCarrinho(outro.carrinho) + '. Salvar mesmo assim, como outro cadastro?')) return;
      var e = I.salvarEq({ id: cad.id, sn: sn, patrimonio: I.txt(cad.patrimonio), carrinho: cad.carrinho, numero: I.txt(cad.numero), modelo: I.txt(cad.modelo), obs: I.txt(cad.obs), defeitos: cad.defeitos, tipo: cad.tipo });
      ultimoCarrinho = e.carrinho; ultimoTipo = cad.tipo;
      recentes = [e.id].concat(recentes.filter(function (x) { return x !== e.id; })).slice(0, 6);
      toast('Salvo: ' + I.nomeCarrinho(e.carrinho) + (e.numero ? ', nº ' + e.numero : ''));
      cad = novoForm(); cad.numero = numSug(cad.carrinho);
      render();
      setTimeout(function () { var el = $('#f-sn'); if (el) el.focus(); }, 50);
    }

    form = h('form', { class: 'card', onsubmit: salvar, autocomplete: 'off' },
      h('label', { class: 'f' }, 'Número de série (N/S)', linhaSn), ckSem, aviso,
      h('div', { class: 'row2' }, h('label', { class: 'f' }, 'Tipo de equipamento', selT), h('label', { class: 'f' }, 'Carrinho ou local', selC)),
      h('div', { class: 'row2' }, h('label', { class: 'f' }, 'Nº no carrinho (se tiver)', inNum), h('label', { class: 'f' }, 'Patrimônio', inPat)),
      h('label', { class: 'f' }, 'Modelo', inMod),
      h('details', { open: cad.defeitos.length > 0 }, h('summary', { style: 'cursor:pointer;font-weight:600;padding:6px 0' }, 'Defeitos e observações'),
        h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:8px' }, defs, h('label', { class: 'f' }, 'Observação', inObs))),
      h('div', { class: 'btns' },
        h('button', { type: 'submit', class: 'btn pri' }, editando ? 'Salvar alterações' : 'Salvar e próximo'),
        h('button', { type: 'button', class: 'btn', onclick: function () { cad = null; render(); } }, editando ? 'Cancelar' : 'Limpar'),
        editando ? h('button', { type: 'button', class: 'btn bad', onclick: function () { if (confirm('Apagar este cadastro?')) { I.removerEq(cad.id); cad = null; toast('Cadastro apagado.'); render(); } } }, 'Apagar') : null));
    add(root, form);
    mostrarAviso();

    var rec = recentes.map(function (id) { return I.S.equipamentos.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
    if (rec.length && !editando) {
      var lista = h('div', { class: 'list' });
      rec.forEach(function (e) { add(lista, itemEq(e)); });
      add(root, h('div', { class: 'card' }, h('h2', 'Salvos agora'), lista));
    }
    return root;
  }
  function novoCarrinhoDlg(cb) {
    var inp = h('input', { type: 'text', placeholder: 'Ex.: Carrinho 01 (azul) ou Laboratório de Informática' });
    var tp = h('select', null, h('option', { value: 'carrinho' }, 'Carrinho (equipamentos numerados)'), h('option', { value: 'local' }, 'Local fixo (sala, laboratório, secretaria…)'));
    abrirDlg([dlgTopo('Novo carrinho ou local'), h('label', { class: 'f' }, 'Nome', inp), h('label', { class: 'f' }, 'O que é', tp),
      h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () {
        if (!I.txt(inp.value)) return;
        var c = I.carrinhoPorNome(inp.value, true, tp.value); c.tipo = c.tipo || tp.value; I.sugerirLocaisDosCarrinhos(); I.save(); fecharDlg(); cb(c);
      } }, 'Criar'), h('button', { class: 'btn', onclick: fecharDlg }, 'Cancelar'))]);
    setTimeout(function () { inp.focus(); }, 50);
  }

  /* ---------- EQUIPAMENTOS ---------- */
  function itemEq(e) {
    var p = I.conferir().porEq[e.id], est = null;
    if (temSistema() && p) est = p.estado === 'semsn' ? h('span', { class: 'badge b-mut' }, 'Conta por quantidade') : p.estado === 'confere' ? h('span', { class: 'badge b-ok' }, 'Confere') : p.estado === 'local' ? h('span', { class: 'badge b-warn' }, 'Local diferente') : p.estado === 'parecido' ? h('span', { class: 'badge b-warn' }, 'Parecido no sistema') : h('span', { class: 'badge b-bad' }, 'Não está no sistema');
    return h('button', { class: 'item', type: 'button', onclick: function () { detalheEq(e); } },
      h('span', { class: 'main' }, h('span', { class: 'sn' }, e.sn || 'Sem N/S' + (e.patrimonio ? ' · pat. ' + e.patrimonio : '')), h('span', { class: 'sub' }, [I.nomeCarrinho(e.carrinho), e.numero ? 'nº ' + e.numero : '', I.tipoDe(e) !== 'Chromebook' ? I.tipoDe(e) : '', e.modelo].filter(Boolean).join(' · '))),
      h('span', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-end' }, badgeUso(e), est));
  }
  function detalheEq(e) {
    var p = I.conferir().porEq[e.id], kv = h('dl', { class: 'kv' });
    function par(k, v) { add(kv, h('dt', k)); add(kv, h('dd', v || '—')); }
    par('Tipo', I.tipoDe(e));
    par('Carrinho ou local', I.nomeCarrinho(e.carrinho) + (e.numero ? ', nº ' + e.numero : ''));
    par('Patrimônio', e.patrimonio); par('Modelo', e.modelo);
    par('Defeitos', (e.defeitos || []).map(function (id) { return I.DEF_POR_ID[id] ? I.DEF_POR_ID[id].nome : id; }).join(', '));
    par('Observação', e.obs);
    var sis = h('dl', { class: 'kv' }), nota = null;
    if (!temSistema()) nota = h('p', { class: 'muted' }, 'Importe a lista do sistema para comparar.');
    else if (p && p.estado === 'semsn') nota = h('div', { class: 'note n-info' }, h('b', 'Sem N/S'), h('p', 'Este equipamento não é conferido pelo N/S. Ele entra na contagem por quantidade do local.'));
    else if (p && p.m) {
      var it = p.m.item;
      [['N. Série', it.sn], ['Modelo', it.modelo], ['Local', it.local], ['Situação', it.situacao], ['Patrimônio', it.patrimonio]].forEach(function (x) { if (x[1]) { add(sis, h('dt', x[0])); add(sis, h('dd', x[1])); } });
      if (p.aviso) nota = h('div', { class: 'note n-info' }, h('p', p.aviso));
    } else if (p && p.parecido) nota = h('div', { class: 'note n-warn' }, h('b', 'Provável erro de digitação'), h('p', 'O mais parecido no sistema é ' + p.parecido.sn + (p.parecido.local ? ' (' + p.parecido.local + ')' : '') + '.'));
    else nota = h('div', { class: 'note n-bad' }, h('b', 'Não está no sistema'), h('p', 'Este N/S não existe na lista importada.'));
    var caso = p && p.caso && !p.caso.resolvido ? h('div', { class: 'note n-warn' }, h('b', p.caso.titulo), h('p', p.caso.texto), h('p', p.caso.acao)) : null;
    abrirDlg([dlgTopo(e.sn || 'Sem N/S'), h('div', { class: 'chips' }, badgeUso(e)),
      h('h3', 'O que você cadastrou'), kv, h('h3', 'O que o sistema diz'), sis, nota, caso,
      h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () { fecharDlg(); carregarEdicao(e); } }, 'Editar'),
        h('button', { class: 'btn bad', onclick: function () { if (confirm('Apagar este cadastro?')) { I.removerEq(e.id); fecharDlg(); toast('Cadastro apagado.'); render(); } } }, 'Apagar'))]);
  }
  function vEquip() {
    var S = I.S, root = h('div', { class: 'view' });
    add(root, h('div', null, h('h1', 'Equipamentos'), h('p', { class: 'muted' }, 'Procure por qualquer pedaço do N/S, pelo patrimônio ou pelo modelo.')));
    var lista = h('div', { class: 'list' }), cont = h('p', { class: 'muted' });
    var q = h('input', { type: 'search', placeholder: 'Buscar N/S, patrimônio ou modelo', value: eqFiltro.q, oninput: function () { eqFiltro.q = this.value; eqFiltro.max = 60; desenhar(); } });
    var sel = h('select', { onchange: function () { eqFiltro.c = this.value; eqFiltro.max = 60; desenhar(); } }, h('option', { value: '' }, 'Todos os carrinhos e locais'),
      S.carrinhos.map(function (c) { return h('option', { value: c.id }, c.nome); }));
    sel.value = eqFiltro.c;
    var selTp = h('select', { onchange: function () { eqFiltro.t = this.value; eqFiltro.max = 60; desenhar(); } }, h('option', { value: '' }, 'Todos os tipos'), I.tipos().map(function (t) { return h('option', { value: t }, t); }));
    selTp.value = eqFiltro.t;
    var barra = h('div', { class: 'card flat' }, h('div', { class: 'row2' }, q, sel), h('div', { class: 'row2' }, selTp));
    add(root, barra, h('div', { class: 'card' }, cont, lista));
    function desenhar() {
      lista.textContent = '';
      var n = I.norm(eqFiltro.q), tx = I.semAcento(eqFiltro.q);
      var itens = S.equipamentos.filter(function (e) {
        if (eqFiltro.c && e.carrinho !== eqFiltro.c) return false;
        if (eqFiltro.t && I.tipoDe(e) !== eqFiltro.t) return false;
        if (!eqFiltro.q) return true;
        return (n && I.norm(e.sn).indexOf(n) >= 0) || (n && I.norm(e.patrimonio) === n) || I.semAcento(e.modelo).indexOf(tx) >= 0;
      }).sort(function (a, b) { return I.nomeCarrinho(a.carrinho).localeCompare(I.nomeCarrinho(b.carrinho), 'pt-BR') || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0); });
      cont.textContent = itens.length + (itens.length === 1 ? ' equipamento' : ' equipamentos');
      itens.slice(0, eqFiltro.max).forEach(function (e) { add(lista, itemEq(e)); });
      if (itens.length > eqFiltro.max) add(lista, h('button', { class: 'btn', style: 'margin-top:10px', onclick: function () { eqFiltro.max += 60; desenhar(); } }, 'Mostrar mais'));
      // só no sistema
      if (n.length >= 4 && temSistema() && !eqFiltro.c) {
        var casados = {}; S.equipamentos.forEach(function (e) { var m = I.acharSistema(e.sn); if (m) casados[m.item.sn] = 1; });
        var so = S.sistema.itens.filter(function (it) { return I.norm(it.sn).indexOf(n) >= 0 && !casados[it.sn]; }).slice(0, 10);
        if (so.length) {
          add(lista, h('h3', { style: 'margin-top:14px' }, 'Está só no sistema (não cadastrado aqui)'));
          so.forEach(function (it) {
            add(lista, h('button', { class: 'item', type: 'button', onclick: function () {
              abrirDlg([dlgTopo(it.sn), h('div', { class: 'note n-info' }, h('p', 'Este N/S está no sistema, mas você ainda não o cadastrou.')),
                h('dl', { class: 'kv' }, h('dt', 'Modelo'), h('dd', it.modelo || '—'), h('dt', 'Local'), h('dd', it.local || '—'), h('dt', 'Situação'), h('dd', it.situacao || '—')),
                h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () { fecharDlg(); cad = novoForm(); cad.sn = it.sn; cad.modelo = I.modeloPara(it.sn) || it.modelo || ''; var c = I.mapaLocais()[it.local]; if (it.categoria) cad.tipo = it.categoria; if (c) { cad.carrinho = c.id; cad.numero = numSug(c.id); } ir('cadastrar'); } }, 'Cadastrar este'))]);
            } }, h('span', { class: 'main' }, h('span', { class: 'sn' }, it.sn), h('span', { class: 'sub' }, [it.local, it.modelo].filter(Boolean).join(' · '))), h('span', { class: 'badge b-info' }, 'Só no sistema')));
          });
        }
      }
      if (!itens.length && !S.equipamentos.length) add(lista, h('div', { class: 'empty' }, h('b', 'Nada cadastrado ainda'), h('span', { class: 'muted' }, 'Cadastre equipamentos ou importe a sua planilha.'), h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () { ir('cadastrar'); } }, 'Cadastrar'), h('button', { class: 'btn', onclick: function () { ir('importar'); } }, 'Importar planilha'))));
    }
    desenhar();
    return root;
  }

  /* ---------- CONFERIR ---------- */
  function vConferir() {
    var root = h('div', { class: 'view' });
    add(root, h('div', null, h('h1', 'Conferir'), h('p', { class: 'muted' }, 'O que não bate entre o seu cadastro e o sistema, e o que precisa de atenção.')));
    add(root, h('div', { class: 'chips' },
      chip('Diferenças com o sistema', cfFiltro.aba === 'casos', function () { cfFiltro.aba = 'casos'; render(); }),
      chip('Defeitos e patrimônio', cfFiltro.aba === 'atencao', function () { cfFiltro.aba = 'atencao'; render(); })));
    if (cfFiltro.aba === 'atencao') { add(root, vAtencao()); return root; }
    if (!temSistema()) { add(root, h('div', { class: 'empty' }, h('b', 'Falta a lista do sistema'), h('span', { class: 'muted' }, 'Para conferir, importe a planilha que a Secretaria exporta.'), h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () { ir('importar'); } }, 'Importar lista do sistema')))); return root; }
    var cf = I.conferir(), todos = cf.casos;
    var tipos = {}; todos.forEach(function (c) { tipos[c.tipo] = c.titulo; });
    var abertos = todos.filter(function (c) { return !c.resolvido; }).length;
    add(root, h('div', { class: 'card flat' }, h('div', { class: 'card-h' },
      h('div', { class: 'chips' },
        chip('Abertos (' + abertos + ')', cfFiltro.sit === 'abertos', function () { cfFiltro.sit = 'abertos'; cfFiltro.max = 40; render(); }),
        chip('Resolvidos (' + (todos.length - abertos) + ')', cfFiltro.sit === 'resolvidos', function () { cfFiltro.sit = 'resolvidos'; cfFiltro.max = 40; render(); }),
        chip('Todos', cfFiltro.sit === 'todos', function () { cfFiltro.sit = 'todos'; cfFiltro.max = 40; render(); })),
      h('select', { style: 'max-width:20rem', onchange: function () { cfFiltro.tipo = this.value; cfFiltro.max = 40; render(); } }, h('option', { value: '' }, 'Todos os tipos'),
        Object.keys(tipos).map(function (t) { return h('option', { value: t, selected: cfFiltro.tipo === t }, tipos[t]); })))));
    var tiposEq = []; todos.forEach(function (c) { var t = I.tipoDeCaso(c); if (tiposEq.indexOf(t) < 0) tiposEq.push(t); });
    var NG = { '': 'Todos os grupos', sistema: 'Mudar local no sistema', etiqueta: 'Conferir etiqueta', procurar: 'Procurar ou cadastrar' };
    add(root, h('div', { class: 'card flat' }, h('div', { class: 'chips' }, ['', 'sistema', 'etiqueta', 'procurar'].map(function (g) {
        return chip(NG[g], cfFiltro.grupo === g, function () { cfFiltro.grupo = g; cfFiltro.max = 40; render(); }); })),
      tiposEq.length > 1 ? h('select', { style: 'max-width:20rem', onchange: function () { cfFiltro.eqTipo = this.value; cfFiltro.max = 40; render(); } }, h('option', { value: '' }, 'Todos os tipos de equipamento'),
        tiposEq.map(function (t) { return h('option', { value: t, selected: cfFiltro.eqTipo === t }, t); })) : null));
    var lista = todos.filter(function (c) {
      if (cfFiltro.sit === 'abertos' && c.resolvido) return false;
      if (cfFiltro.sit === 'resolvidos' && !c.resolvido) return false;
      if (cfFiltro.grupo && I.grupoDeCaso(c.tipo) !== cfFiltro.grupo) return false;
      if (cfFiltro.eqTipo && I.tipoDeCaso(c) !== cfFiltro.eqTipo) return false;
      return !cfFiltro.tipo || c.tipo === cfFiltro.tipo;
    });
    if (!lista.length) add(root, h('div', { class: 'note n-ok' }, h('b', cfFiltro.sit === 'abertos' ? 'Nada em aberto' : 'Nenhum caso aqui'), h('p', 'Tudo que foi cadastrado confere com o sistema.')));
    lista.slice(0, cfFiltro.max).forEach(function (c) { add(root, cardCaso(c)); });
    if (lista.length > cfFiltro.max) add(root, h('button', { class: 'btn', onclick: function () { cfFiltro.max += 40; render(); } }, 'Mostrar mais'));
    if (todos.length) add(root, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: function () { I.exportarXlsx((I.S.meta.escola || 'inventario').replace(/[^\w\-]+/g, '_') + '.xlsx'); } }, 'Baixar planilha com a lista "Atualizar no sistema"')));
    return root;
  }
  function chip(t, on, fn) { return h('button', { class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, t); }
  var CORTIPO = { provavel_erro: 'b-warn', nao_encontrado: 'b-bad', local_diferente: 'b-warn', registro_unico: 'b-warn', duplicado: 'b-warn', a_procurar: 'b-info' };
  function cardCaso(c) {
    var ck = h('input', { type: 'checkbox', checked: c.resolvido, style: 'width:22px;height:22px;accent-color:var(--ok)', 'aria-label': 'Marcar como resolvido', onchange: function () { I.resolverCaso(c.key, this.checked, nota.value); render(); } });
    var nota = h('textarea', { placeholder: 'Anotação (opcional). Ex.: conferi a etiqueta, era erro de digitação.', style: 'min-height:54px', onchange: function () { I.resolverCaso(c.key, ck.checked, this.value); } }); nota.value = c.nota;
    return h('div', { class: 'card caso' + (c.resolvido ? ' res' : '') },
      h('div', { class: 'meta' }, h('span', { class: 'badge ' + (c.resolvido ? 'b-ok' : CORTIPO[c.tipo] || 'b-mut') }, c.resolvido ? 'Resolvido' : c.titulo),
        c.eq ? h('b', c.eq.sn) : (c.sis ? h('b', c.sis.sn) : null),
        c.eq ? h('span', { class: 'muted' }, I.nomeCarrinho(c.eq.carrinho) + (c.eq.numero ? ', nº ' + c.eq.numero : '')) : (c.sis && c.sis.local ? h('span', { class: 'muted' }, c.sis.local.trim()) : null)),
      h('p', c.texto), h('div', null, h('div', { class: 'lbl' }, 'O que fazer'), h('p', c.acao)),
      h('div', { class: 'btns', style: 'align-items:center' }, h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer' }, ck, 'Resolvido'),
        c.eq ? h('button', { class: 'btn sm', onclick: function () { carregarEdicao(c.eq); } }, 'Editar cadastro') : null),
      nota);
  }
  function vAtencao() {
    var at = I.atencao(), card = h('div', { class: 'card' });
    var tipos = {}; at.forEach(function (a) { tipos[a.tipo] = (tipos[a.tipo] || 0) + 1; });
    add(card, h('p', { class: 'muted' }, Object.keys(tipos).map(function (t) { return tipos[t] + ' ' + t.toLowerCase(); }).join(' · ') || 'Nenhum defeito ou patrimônio faltando.'));
    var lista = h('div', { class: 'list' });
    at.forEach(function (a) {
      add(lista, h('button', { class: 'item', type: 'button', onclick: function () { detalheEq(a.eq); } },
        h('span', { class: 'main' }, h('span', { class: 'sn' }, a.eq.sn), h('span', { class: 'sub' }, I.nomeCarrinho(a.eq.carrinho) + (a.eq.numero ? ', nº ' + a.eq.numero : '') + ' · ' + a.texto)),
        h('span', { class: 'badge ' + (a.tipo === 'Defeito' ? 'b-warn' : 'b-mut') }, a.tipo)));
    });
    add(card, lista);
    return card;
  }

  /* ---------- IMPORTAR ---------- */
  function vImportar() {
    var S = I.S, root = h('div', { class: 'view' });
    add(root, h('div', null, h('h1', 'Importar planilhas'), h('p', { class: 'muted' }, 'A planilha é lida aqui no aparelho. Ela não é enviada a ninguém.')));
    if (imp && imp.etapa) { add(root, vImpAssistente()); return root; }
    if (imp && imp.fim) { add(root, imp.fim); return root; }
    add(root, h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', '1. Lista do sistema'),
        h('p', { class: 'muted' }, 'A planilha que a Secretaria exporta com os equipamentos da escola. Serve para conferir N/S e local.'),
        temSistema() ? h('div', { class: 'note n-ok' }, h('b', S.sistema.itens.length + ' itens já importados'), h('p', (S.sistema.arquivo || '') + (S.sistema.importadoEm ? ' em ' + fmtData(S.sistema.importadoEm) : ''))) : null,
        h('div', { class: 'btns' }, arquivoBtn(temSistema() ? 'Atualizar a lista' : 'Escolher a planilha', function (f) { iniciarImp('sistema', f); }, true))),
      h('div', { class: 'card' }, h('h2', '2. Minha planilha de inventário'),
        h('p', { class: 'muted' }, 'Se você já tem uma planilha com N/S, carrinhos e defeitos, o aplicativo aproveita. Opcional.'),
        h('div', { class: 'btns' }, arquivoBtn('Escolher a planilha', function (f) { iniciarImp('minha', f); }, false)))));
    add(root, h('div', { class: 'note n-info' }, h('b', 'Dica'), h('p', 'Importe primeiro a lista do sistema. Assim, ao importar a sua planilha ou cadastrar, os carrinhos já são ligados aos locais do sistema.')));
    return root;
  }
  function arquivoBtn(texto, cb, pri) {
    var inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, onchange: function () { if (this.files && this.files[0]) cb(this.files[0]); this.value = ''; } });
    return h('label', { class: 'btn' + (pri ? ' pri' : ''), style: 'cursor:pointer' }, texto, inp);
  }
  function iniciarImp(modo, arquivo) {
    if (typeof XLSX === 'undefined') { toast('A biblioteca de planilhas não carregou. Confira a internet e recarregue.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var wb = XLSX.read(rd.result, { type: 'array' });
        var abas = wb.SheetNames.map(function (n) { var rows = I.rowsDe(wb, n), hi = I.acharCabecalho(rows); return { nome: n, rows: rows, hdrIdx: hi, n: Math.max(0, rows.length - hi - 1) }; }).filter(function (a) { return a.rows.length > 1; });
        if (!abas.length) { toast('Não achei dados nessa planilha.'); return; }
        var campos = modo === 'sistema' ? I.CAMPOS_SISTEMA : I.CAMPOS_MINHA;
        // aba inicial: a que tem mais linhas
        var AUX = /^(sistema|resumo|diverg|confer|comodato|painel|legenda|instru|lista do sistema|export)/i;
        abas.forEach(function (a) { var m = I.sugerirMapa(a.rows, a.hdrIdx, modo === 'sistema' ? I.CAMPOS_SISTEMA : I.CAMPOS_MINHA); a.temSn = !!m && m.sn >= 0; a.aux = AUX.test(a.nome.trim()) && !/equip|invent/i.test(a.nome); });
        var candidatas = abas.filter(function (a) { return a.temSn && !a.aux; });
        var principal = (candidatas.length ? candidatas : abas).slice().sort(function (a, b) { return b.n - a.n; })[0];
        imp = { modo: modo, arquivo: arquivo.name, abas: abas, campos: campos, etapa: 1, ativa: principal.nome, marcadas: {}, mapa: null,
          categorias: null, abaComoCarrinho: false, atualizar: true };
        if (modo === 'minha') abas.forEach(function (a) { imp.marcadas[a.nome] = a.n >= 3 && a.temSn && !a.aux; });
        recalcMapa(true);
        render();
      } catch (e) { toast('Não consegui ler essa planilha: ' + e.message); }
    };
    rd.readAsArrayBuffer(arquivo);
  }
  function abaAtiva() { return imp.abas.filter(function (a) { return a.nome === imp.ativa; })[0]; }
  function recalcMapa(refazerCats) {
    var a = abaAtiva();
    imp.mapa = I.sugerirMapa(a.rows, a.hdrIdx, imp.campos);
    if (imp.modo === 'minha' && imp.mapa.carrinho < 0) imp.abaComoCarrinho = true;
    if (imp.modo === 'sistema') refazerCats = true;
    if (refazerCats) atualizarCats();
  }
  function atualizarCats() {
    var a = abaAtiva();
    if (imp.modo !== 'sistema' || imp.mapa.categoria < 0) { imp.categorias = null; return; }
    var vals = I.valores(a.rows, a.hdrIdx, imp.mapa.categoria);
    var marcados = vals.map(function (v) { return v.v; });
    imp.categorias = { valores: vals, marcadas: marcados };
  }
  function vImpAssistente() {
    var a = abaAtiva(), sis = imp.modo === 'sistema';
    var card = h('div', { class: 'card' });
    add(card, h('div', { class: 'card-h' }, h('h2', sis ? 'Lista do sistema' : 'Minha planilha'), h('span', { class: 'muted' }, imp.arquivo)));

    if (imp.abas.length > 1 || !sis) {
      if (sis) {
        add(card, h('label', { class: 'f' }, 'Aba da planilha', h('select', { onchange: function () { imp.ativa = this.value; recalcMapa(true); render(); } },
          imp.abas.map(function (x) { return h('option', { value: x.nome, selected: x.nome === imp.ativa }, x.nome + ' (' + x.n + ' linhas)'); }))));
      } else {
        add(card, h('div', null, h('div', { class: 'lbl muted', style: 'font-size:.82rem;font-weight:600;margin-bottom:6px' }, 'Quais abas importar'),
          h('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:8px' }, 'Marque só as abas com os SEUS equipamentos. Abas de resumo, sistema ou conferência não devem ser marcadas, senão os equipamentos aparecem repetidos.'),
          h('div', { class: 'defs' }, imp.abas.map(function (x) {
            return h('label', null, h('input', { type: 'checkbox', checked: !!imp.marcadas[x.nome], onchange: function () { imp.marcadas[x.nome] = this.checked; if (this.checked && !imp.ativa) { imp.ativa = x.nome; } } }), x.nome + ' (' + x.n + ')' + (x.aux ? ' – parece ser aba de apoio' : (x.temSn ? '' : ' – sem coluna de N/S')));
          })),
          imp.abas.length > 1 ? h('label', { class: 'f', style: 'margin-top:10px' }, 'Usar esta aba para identificar as colunas', h('select', { onchange: function () { imp.ativa = this.value; recalcMapa(false); render(); } },
            imp.abas.map(function (x) { return h('option', { value: x.nome, selected: x.nome === imp.ativa }, x.nome); }))) : null));
      }
    }
    add(card, h('label', { class: 'f', style: 'max-width:14rem' }, 'Linha do cabeçalho (títulos das colunas)', h('input', { type: 'number', min: 1, value: a.hdrIdx + 1, onchange: function () { a.hdrIdx = Math.max(0, (parseInt(this.value, 10) || 1) - 1); recalcMapa(true); render(); } })));

    var heads = (a.rows[a.hdrIdx] || []).map(function (x, i) { return { i: i, t: I.txt(x) || '(coluna ' + (i + 1) + ')' }; });
    var map = h('div', { class: 'grid g2' });
    imp.campos.forEach(function (c) {
      var sel = h('select', { onchange: function () { imp.mapa[c.id] = parseInt(this.value, 10); if (c.id === 'categoria') atualizarCats(); render(); } },
        h('option', { value: -1 }, c.obrig ? 'Escolha a coluna…' : 'Não tenho'), heads.map(function (x) { return h('option', { value: x.i, selected: imp.mapa[c.id] === x.i }, x.t); }));
      add(map, h('label', { class: 'f' }, c.nome + (c.obrig ? ' *' : ''), sel));
    });
    add(card, h('div', null, h('h3', { style: 'margin-bottom:8px' }, 'Qual coluna é qual?'), map));

    if (sis && imp.categorias) {
      add(card, h('div', null, h('h3', { style: 'margin-bottom:6px' }, 'Quais tipos de equipamento importar'),
        h('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:8px' }, 'O sistema lista de tudo (Chromebooks, monitores, óculos…). Desmarque o que você não vai inventariar.'),
        h('div', { class: 'defs' }, imp.categorias.valores.map(function (v) {
          return h('label', null, h('input', { type: 'checkbox', checked: imp.categorias.marcadas.indexOf(v.v) >= 0, onchange: function () {
            var l = imp.categorias.marcadas, i = l.indexOf(v.v); if (this.checked && i < 0) l.push(v.v); if (!this.checked && i >= 0) l.splice(i, 1); } }), v.v + ' (' + v.n + ')');
        }))));
    }
    if (!sis) {
      add(card, h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        imp.mapa.carrinho < 0 || true ? h('label', { style: 'display:flex;gap:10px;align-items:center;cursor:pointer' }, h('input', { type: 'checkbox', style: 'width:20px;height:20px;accent-color:var(--brand)', checked: imp.abaComoCarrinho, onchange: function () { imp.abaComoCarrinho = this.checked; } }), 'Quando a linha não tiver carrinho, usar o nome da aba como carrinho') : null,
        h('label', { style: 'display:flex;gap:10px;align-items:center;cursor:pointer' }, h('input', { type: 'checkbox', style: 'width:20px;height:20px;accent-color:var(--brand)', checked: imp.atualizar, onchange: function () { imp.atualizar = this.checked; } }), 'Se o N/S já estiver cadastrado, completar só o que estiver em branco')));
    }

    // prévia
    var cols = imp.campos.filter(function (c) { return imp.mapa[c.id] >= 0; });
    if (cols.length) {
      var rows = a.rows.slice(a.hdrIdx + 1).filter(function (r) { return r && I.txt(r[imp.mapa.sn]); }).slice(0, 6);
      var t = h('table', null, h('thead', null, h('tr', null, cols.map(function (c) { return h('th', c.nome); }))),
        h('tbody', null, rows.map(function (r) { return h('tr', null, cols.map(function (c) { return h('td', I.txt(r[imp.mapa[c.id]])); })); })));
      add(card, h('div', null, h('h3', { style: 'margin-bottom:6px' }, 'Prévia (primeiras linhas)'), h('div', { class: 'tbox' }, t)));
    }
    var ok = imp.mapa.sn >= 0;
    add(card, ok ? null : h('div', { class: 'note n-bad' }, h('b', 'Escolha a coluna do número de série'), h('p', 'Sem ela não dá para importar.')));
    add(card, h('div', { class: 'btns' },
      h('button', { class: 'btn pri', disabled: !ok, onclick: executarImp }, 'Importar'),
      h('button', { class: 'btn', onclick: function () { imp = null; render(); } }, 'Cancelar')));
    return card;
  }
  function executarImp() {
    var a = abaAtiva(), r, texto, prox;
    if (imp.modo === 'sistema') {
      r = I.importarSistema(a.rows, a.hdrIdx, imp.mapa, imp.categorias ? imp.categorias.marcadas : null, imp.arquivo);
      texto = [r.importados + ' equipamentos importados.', r.foraDoTipo ? r.foraDoTipo + ' de outros tipos foram deixados de fora.' : '', r.repetidos ? r.repetidos + ' repetidos ignorados.' : '', r.semSn ? r.semSn + ' linhas sem N/S ignoradas.' : '',
        r.regrasNovas ? 'Sugeri ' + r.regrasNovas + ' regras de modelo (veja em Mais).' : '', r.locaisSugeridos ? 'Liguei ' + r.locaisSugeridos + ' carrinhos aos locais do sistema.' : ''].filter(Boolean);
      prox = [h('button', { class: 'btn pri', onclick: function () { imp = null; ir('mais'); } }, 'Conferir modelos e carrinhos'),
        I.sugerirLocaisNovos().length ? h('button', { class: 'btn', onclick: function () { imp = null; ir('painel'); setTimeout(dlgLocaisNovos, 50); } }, 'Criar locais a partir do sistema') : null,
        h('button', { class: 'btn', onclick: function () { imp = null; ir('cadastrar'); } }, 'Cadastrar equipamentos')];
    } else {
      var abas = imp.abas.filter(function (x) { return imp.marcadas[x.nome]; });
      if (!abas.length) { toast('Marque pelo menos uma aba.'); return; }
      var ativa = a;
      var lista = abas.map(function (x) { var c = { nome: x.nome, rows: x.rows, hdrIdx: x.hdrIdx }; if (x.nome !== ativa.nome) c.mapa = I.sugerirMapa(x.rows, x.hdrIdx, imp.campos); if (c.mapa && c.mapa.sn < 0) c.mapa = imp.mapa; return c; });
      r = I.importarMinha(lista, imp.mapa, { abaComoCarrinho: imp.abaComoCarrinho, atualizar: imp.atualizar });
      texto = [r.novos + ' equipamentos novos.', r.atualizados ? r.atualizados + ' completados.' : '', r.carrinhosNovos ? r.carrinhosNovos + ' carrinhos criados.' : '', r.semSn ? r.semSn + ' linhas sem N/S ignoradas.' : '',
        r.locaisSugeridos ? 'Liguei ' + r.locaisSugeridos + ' carrinhos aos locais do sistema.' : ''].filter(Boolean);
      prox = [h('button', { class: 'btn pri', onclick: function () { imp = null; ir('conferir'); } }, 'Ver a conferência'), h('button', { class: 'btn', onclick: function () { imp = null; ir('mais'); } }, 'Revisar carrinhos')];
    }
    imp = { fim: h('div', { class: 'card' }, h('h2', 'Importação concluída'), h('div', { class: 'note n-ok' }, texto.map(function (t) { return h('p', t); })), h('div', { class: 'btns' }, prox, h('button', { class: 'btn', onclick: function () { imp = null; render(); } }, 'Importar outra'))) };
    render();
  }

  /* ---------- MAIS ---------- */
  function vMais() {
    var S = I.S, root = h('div', { class: 'view' });
    add(root, h('div', null, h('h1', 'Mais'), h('p', { class: 'muted' }, 'Escola, carrinhos e locais, modelos, exportação e backup.')));

    // escola
    add(root, h('div', { class: 'card' }, h('h2', 'Escola'),
      h('label', { class: 'f' }, 'Nome da escola', h('input', { type: 'text', value: S.meta.escola, placeholder: 'Ex.: EMEIEF Nome da Escola', onchange: function () { S.meta.escola = this.value.trim(); I.save(); cabecalho(); toast('Nome salvo.'); } }))));

    // carrinhos e locais
    var locais = I.locaisDoSistema(), ccard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', 'Carrinhos e locais'),
      h('div', { class: 'btns' }, temSistema() ? h('button', { class: 'btn sm', onclick: function () { var n = I.sugerirLocaisDosCarrinhos(); I.save(); toast(n ? n + ' ligados automaticamente.' : 'Nada novo para ligar.'); render(); } }, 'Ligar automaticamente') : null,
        temSistema() ? h('button', { class: 'btn sm', onclick: dlgLocaisNovos }, 'Criar a partir do sistema') : null,
        h('button', { class: 'btn sm pri', onclick: function () { novoCarrinhoDlg(function () { render(); }); } }, 'Novo'))),
      h('p', { class: 'muted', style: 'font-size:.9rem' }, 'Carrinhos são equipamentos numerados. Locais fixos são salas, laboratório, secretaria… Ligue cada um ao nome que o sistema usa. Um local pode juntar vários nomes do sistema (por exemplo, os mini PCs e os monitores do laboratório).'));
    if (!S.carrinhos.length) add(ccard, h('p', { class: 'muted' }, 'Nenhum carrinho ou local ainda. Eles são criados ao cadastrar ou importar.'));
    S.carrinhos.forEach(function (c) {
      var n = S.equipamentos.filter(function (e) { return e.carrinho === c.id; }).length, lig = I.locaisDe(c);
      var lista = h('div', { class: 'sel-local' }, locais.map(function (l) {
        return h('label', null, h('input', { type: 'checkbox', checked: lig.indexOf(l.nome) >= 0, onchange: function () {
          var i = c.locaisSis.indexOf(l.nome); if (this.checked && i < 0) c.locaisSis.push(l.nome); if (!this.checked && i >= 0) c.locaisSis.splice(i, 1);
          I.invalidarCasos(); I.save(); cabecalho(); resumoSel.textContent = c.locaisSis.length ? 'Ligado a ' + c.locaisSis.length + ' nome(s) do sistema' : 'Sem ligação com o sistema'; } }), h('span', null, l.nome.trim() + ' (' + l.n + ')'));
      }));
      var resumoSel = h('summary', { style: 'cursor:pointer;font-weight:600;font-size:.9rem' }, !temSistema() ? 'Importe a lista do sistema para ligar' : (lig.length ? 'Ligado a ' + lig.length + ' nome(s) do sistema' : 'Sem ligação com o sistema'));
      add(ccard, h('div', { class: 'cart' }, h('div', { class: 'row2' },
        h('label', { class: 'f' }, 'Nome (' + n + ' equipamentos)', h('input', { type: 'text', value: c.nome, onchange: function () { if (this.value.trim()) { c.nome = this.value.trim(); I.save(); } } })),
        h('label', { class: 'f' }, 'O que é', h('select', { onchange: function () { c.tipo = this.value; I.save(); render(); } }, h('option', { value: 'carrinho', selected: (c.tipo || 'carrinho') === 'carrinho' }, 'Carrinho'), h('option', { value: 'local', selected: c.tipo === 'local' }, 'Local fixo')))),
        temSistema() ? h('details', null, resumoSel, lista) : h('p', { class: 'muted', style: 'font-size:.88rem' }, 'Importe a lista do sistema para ligar.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn sm bad', onclick: function () {
          if (n && !confirm('Este carrinho ou local tem ' + n + ' equipamentos. Eles ficarão sem carrinho. Apagar mesmo?')) return;
          S.equipamentos.forEach(function (e) { if (e.carrinho === c.id) e.carrinho = ''; });
          S.carrinhos = S.carrinhos.filter(function (x) { return x.id !== c.id; }); I.invalidarCasos(); I.save(); render();
        } }, 'Apagar'))));
    });
    add(root, ccard);

    // modelos
    var mcard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', 'Regras de modelo'),
      h('div', { class: 'btns' }, temSistema() ? h('button', { class: 'btn sm', onclick: function () { S.meta.regrasModelo = I.sugerirRegrasModelo(); I.save(); toast('Regras refeitas a partir do sistema.'); render(); } }, 'Sugerir pelo sistema') : null,
        h('button', { class: 'btn sm', onclick: function () { S.meta.regrasModelo.push({ prefixo: '', modelo: '' }); I.save(); render(); } }, 'Nova regra'))),
      h('p', { class: 'muted', style: 'font-size:.9rem' }, 'Se o N/S começa com o prefixo, o modelo é preenchido sozinho no cadastro. Exemplo: prefixo 09S29Q = Samsung Chromebook 4 prata.'));
    S.meta.regrasModelo.forEach(function (r, i) {
      add(mcard, h('div', { class: 'row-inl' }, h('input', { class: 'mono', style: 'max-width:9rem', type: 'text', placeholder: 'Prefixo', value: r.prefixo, onchange: function () { r.prefixo = this.value.trim(); I.save(); } }),
        h('input', { type: 'text', placeholder: 'Modelo', value: r.modelo, onchange: function () { r.modelo = this.value.trim(); I.save(); } }),
        h('button', { class: 'btn sm bad', 'aria-label': 'Apagar regra', onclick: function () { S.meta.regrasModelo.splice(i, 1); I.save(); render(); } }, '×')));
    });
    add(root, mcard);

    // exportar e backup
    add(root, h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', 'Exportar para planilha'), h('p', { class: 'muted', style: 'font-size:.9rem' }, 'Gera um arquivo do Excel com o resumo, os equipamentos, a conferência e a lista do que atualizar no sistema.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn pri', disabled: !S.equipamentos.length, onclick: function () { I.exportarXlsx((S.meta.escola || 'inventario').replace(/[^\w\-]+/g, '_') + '.xlsx'); } }, 'Baixar planilha'))),
      h('div', { class: 'card' }, h('h2', 'Backup'), h('p', { class: 'muted', style: 'font-size:.9rem' }, 'O backup guarda tudo em um arquivo. Use para não perder os dados ou para levar para outro aparelho.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn pri', onclick: function () { baixar((S.meta.escola || 'inventario').replace(/[^\w\-]+/g, '_') + '-backup-' + new Date().toISOString().slice(0, 10) + '.json', I.gerarBackup(), 'application/json'); cabecalho(); toast('Backup baixado.'); } }, 'Baixar backup'),
          arquivoBackup()))));

    add(root, h('div', { class: 'card' }, h('h2', 'Apagar tudo'), h('p', { class: 'muted', style: 'font-size:.9rem' }, 'Remove todos os dados deste aparelho. Baixe um backup antes.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn bad', onclick: function () { if (confirm('Apagar TODOS os dados deste aparelho? Isso não pode ser desfeito.') && confirm('Tem certeza? Já fez o backup?')) { I.zerar().then(function () { cad = null; recentes = []; toast('Dados apagados.'); ir('painel'); }); } } }, 'Apagar todos os dados'))));
    return root;
  }
  function arquivoBackup() {
    var inp = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var r = I.mesclarBackup(rd.result); toast(r.novos + ' novos, ' + r.atualizados + ' atualizados, ' + r.mantidos + ' mantidos.'); render(); }
        catch (e) { toast(e.message); }
      };
      rd.readAsText(f);
    } });
    return h('label', { class: 'btn', style: 'cursor:pointer' }, 'Restaurar backup', inp);
  }

  /* ---------- geral ---------- */
  var VIEWS = { painel: vPainel, cadastrar: vCadastrar, equip: vEquip, conferir: vConferir, importar: vImportar, mais: vMais };
  function render() {
    cabecalho();
    Object.keys(VIEWS).forEach(function (k) {
      var el = $('#v-' + k);
      if (k !== view) { el.hidden = true; el.textContent = ''; return; }
      el.hidden = false; el.textContent = '';
      el.appendChild(VIEWS[k]());
    });
  }
  document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { if (view === 'cadastrar' && b.getAttribute('data-v') !== 'cadastrar' && cad && cad.id) cad = null; ir(b.getAttribute('data-v')); }); });
  $('#dlg').addEventListener('click', function (ev) { if (ev.target === this) fecharDlg(); });
  I.onSaveError = function () { toast('Não consegui salvar neste navegador. Baixe um backup agora.'); };

  I.load().then(function () {
    if (I.S.equipamentos.length || I.S.sistema.itens.length) view = I.S.equipamentos.length ? 'painel' : 'painel';
    render();
  });
  window.addEventListener('beforeunload', function () { I.saveNow(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) I.saveNow(); });
})();
