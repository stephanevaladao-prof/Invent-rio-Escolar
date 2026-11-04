/* Inventário Escolar: núcleo (dados locais, comparação com o sistema, importação, backup).
   Tudo roda no navegador. Nada é enviado para fora. */
(function (g) {
  'use strict';

  var DB = 'inventario-escolar', STORE = 'kv', KEY = 'estado';
  var S = null;
  var INV = { onSaveError: null };

  /* ---------- tipos de defeito ---------- */
  var DEFEITOS = [
    { id: 'tela_quebrada', nome: 'Tela quebrada', uso: 'fora', rx: /tela (quebrada|trincada|rachada)|trincad|rachad/i },
    { id: 'nao_liga', nome: 'Não liga', uso: 'fora', rx: /n[ãa]o liga|n[ãa]o est[áa] ligando|n[ãa]o est[áa] ligando|n[ãa]o inicia/i },
    { id: 'nao_carrega', nome: 'Não carrega', uso: 'fora', rx: /n[ãa]o carrega|n[ãa]o est[áa] carregando/i },
    { id: 'tela_pisca', nome: 'Tela piscando ou tremendo', uso: 'fora', rx: /piscando|tremendo|tela (com problema|danificada)|tela est[áa] com problema/i },
    { id: 'tela_mancha', nome: 'Mancha na tela', uso: 'ressalva', rx: /manch/i },
    { id: 'dobradica', nome: 'Dobradiça quebrada ou solta', uso: 'ressalva', rx: /dobradi[çc]a|abre e fecha|soltando/i },
    { id: 'teclas', nome: 'Teclas faltando ou sem funcionar', uso: 'ressalva', rx: /tecla/i },
    { id: 'touchpad', nome: 'Touchpad com defeito', uso: 'ressalva', rx: /touchpad|mouse/i },
    { id: 'outro', nome: 'Outro defeito (descreva na observação)', uso: 'ressalva', rx: null }
  ];
  var DEF_POR_ID = {};
  DEFEITOS.forEach(function (d) { DEF_POR_ID[d.id] = d; });

  /* ---------- utilidades ---------- */
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(s) { return txt(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function semAcento(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function lev(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var minRow = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < minRow) minRow = cur[j];
      }
      if (minRow > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* ---------- armazenamento ---------- */
  function vazio() {
    return { v: 1, meta: { escola: '', criado: Date.now(), ultimoBackup: 0, regrasModelo: [] },
      carrinhos: [], sistema: { itens: [], arquivo: '', importadoEm: 0 }, equipamentos: [], casos: {} };
  }
  function idb() {
    return new Promise(function (res, rej) {
      if (!g.indexedDB) { rej(new Error('sem IndexedDB')); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function load() {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE).objectStore(STORE).get(KEY);
        t.onsuccess = function () { res(t.result); };
        t.onerror = function () { rej(t.error); };
      });
    }).catch(function () {
      try { return JSON.parse(localStorage.getItem(DB)); } catch (e) { return null; }
    }).then(function (d) {
      S = d || vazio();
      migrar();
      INV.S = S;
      invalidar();
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* ignora */ } }
      return S;
    });
  }
  /* versões antigas guardavam um só local do sistema por carrinho */
  function migrar() {
    (S.carrinhos || []).forEach(function (c) {
      if (!c.locaisSis) c.locaisSis = c.localSistema ? [c.localSistema] : [];
      delete c.localSistema;
      if (!c.tipo) c.tipo = 'carrinho';
    });
  }
  var timer = null;
  function save() { clearTimeout(timer); timer = setTimeout(saveNow, 200); }
  function saveNow() {
    clearTimeout(timer);
    var copia = S;
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(copia, KEY);
        t.oncomplete = res; t.onerror = function () { rej(t.error); };
      });
    }).catch(function () {
      try { localStorage.setItem(DB, JSON.stringify(S)); }
      catch (e) { if (INV.onSaveError) INV.onSaveError(e); }
    });
  }
  function zerar() { S = vazio(); INV.S = S; invalidar(); return saveNow(); }

  /* ---------- índice do sistema ---------- */
  var idxSis = null, cache = null;
  function invalidar() { idxSis = null; cache = null; }
  function indice() {
    if (idxSis) return idxSis;
    idxSis = { exato: {}, lista: [] };
    S.sistema.itens.forEach(function (it, i) {
      it._n = norm(it.sn); it._i = i;
      idxSis.lista.push(it);
      if (!idxSis.exato[it._n]) idxSis.exato[it._n] = it;
    });
    return idxSis;
  }
  /* Acha o registro do sistema que corresponde a um N/S.
     "exato": iguais. "prefixo": um é o começo do outro (ex.: o sistema sem a letra final). */
  function acharSistema(sn) {
    var n = norm(sn);
    if (!n) return null;
    var ix = indice();
    if (ix.exato[n]) return { item: ix.exato[n], tipo: 'exato' };
    if (n.length < 9) return null;
    var melhor = null;
    ix.lista.forEach(function (it) {
      var p = it._n;
      if (p.length < 9) return;
      var d = Math.abs(p.length - n.length);
      if (d >= 1 && d <= 3 && (n.indexOf(p) === 0 || p.indexOf(n) === 0)) {
        if (!melhor || d < melhor.d) melhor = { item: it, tipo: 'prefixo', d: d };
      }
    });
    return melhor;
  }

  /* ---------- carrinhos, modelos, estado ---------- */
  function carrinho(id) { return S.carrinhos.filter(function (c) { return c.id === id; })[0] || null; }
  function locaisDe(c) { return (c && c.locaisSis) || []; }
  function carrinhoPorNome(nome, criar, tipo) {
    var n = semAcento(nome);
    var c = S.carrinhos.filter(function (x) { return semAcento(x.nome) === n; })[0];
    if (!c && criar && txt(nome)) {
      c = { id: uid(), nome: txt(nome), tipo: tipo || 'carrinho', locaisSis: [] };
      S.carrinhos.push(c);
    }
    return c || null;
  }
  function nomeCarrinho(id) { var c = carrinho(id); return c ? c.nome : '(sem carrinho)'; }
  function modeloPara(sn) {
    var n = norm(sn), melhor = null;
    (S.meta.regrasModelo || []).forEach(function (r) {
      var p = norm(r.prefixo);
      if (p && n.indexOf(p) === 0 && (!melhor || p.length > norm(melhor.prefixo).length)) melhor = r;
    });
    return melhor ? melhor.modelo : '';
  }
  function uso(e) {
    var r = 'ok';
    (e.defeitos || []).forEach(function (id) {
      var d = DEF_POR_ID[id];
      if (!d) return;
      if (d.uso === 'fora') r = 'fora';
      else if (d.uso === 'ressalva' && r === 'ok') r = 'ressalva';
    });
    return r;
  }
  function defeitosDoTexto(t) {
    var ids = [];
    DEFEITOS.forEach(function (d) { if (d.rx && d.rx.test(t) && ids.indexOf(d.id) < 0) ids.push(d.id); });
    return ids;
  }
  function locaisDoSistema() {
    var m = {};
    S.sistema.itens.forEach(function (it) { if (it.local) m[it.local] = (m[it.local] || 0) + 1; });
    return Object.keys(m).sort().map(function (k) { return { nome: k, n: m[k] }; });
  }
  function tokens(s) {
    var out = [];
    semAcento(s).split(/[^a-z0-9]+/).forEach(function (w) {
      if (!w) return;
      if (/^\d+$/.test(w)) out.push('#' + parseInt(w, 10));
      else if (w.length >= 3) out.push(w);
    });
    return out;
  }
  /* Locais do sistema que combinam com um carrinho (um só) ou com um local fixo (todos os que combinam). */
  function sugerirLocaisSis(c) {
    var tk = tokens(c.nome), pts = [], melhor = 0;
    locaisDoSistema().forEach(function (l) {
      var lt = tokens(l.nome), score = 0;
      tk.forEach(function (t) { if (lt.indexOf(t) >= 0) score += t.charAt(0) === '#' ? 5 : 1; });
      if (score > 0) { pts.push({ nome: l.nome, score: score }); if (score > melhor) melhor = score; }
    });
    if (!melhor) return [];
    var ok = pts.filter(function (x) { return x.score === melhor; }).map(function (x) { return x.nome; });
    if ((c.tipo || 'carrinho') === 'carrinho') return ok.slice(0, 1);
    return melhor >= 2 || tk.length === 1 ? ok : [];
  }
  function sugerirLocal(nome) { return sugerirLocaisSis({ nome: nome, tipo: 'carrinho' })[0] || ''; }
  function sugerirLocaisDosCarrinhos() {
    var feitos = 0;
    S.carrinhos.forEach(function (c) {
      if (!locaisDe(c).length) { var s = sugerirLocaisSis(c); if (s.length) { c.locaisSis = s; feitos++; } }
    });
    return feitos;
  }
  function mapaLocais() {
    var m = {};
    S.carrinhos.forEach(function (c) { locaisDe(c).forEach(function (l) { if (!m[l]) m[l] = c; }); });
    return m;
  }
  /* Locais do sistema que ainda não estão ligados a nenhum carrinho ou local seu,
     agrupados pelo nome do lugar (o que vem depois do " - "). */
  function sugerirLocaisNovos() {
    var m = mapaLocais(), grupos = {}, ordem = [];
    locaisDoSistema().forEach(function (l) {
      if (m[l.nome]) return;
      var nome = l.nome.trim(), cart = /^carrinho/i.test(nome), chave, exib;
      var k = nome.lastIndexOf('-');
      if (!cart && k > 0 && k < nome.length - 1) { exib = nome.slice(k + 1).trim(); }
      else exib = nome.replace(/\s+/g, ' ');
      chave = semAcento(exib).replace(/[^a-z0-9]+/g, ' ').trim() + (cart ? '|c' : '');
      if (!grupos[chave]) { grupos[chave] = { nome: exib, tipo: cart ? 'carrinho' : 'local', locais: [], n: 0 }; ordem.push(chave); }
      grupos[chave].locais.push(l.nome); grupos[chave].n += l.n;
    });
    return ordem.map(function (k) { return grupos[k]; });
  }
  function criarLocal(nome, tipo, locais) {
    var c = carrinhoPorNome(nome, true, tipo);
    if (!c.tipo) c.tipo = tipo || 'carrinho';
    locais.forEach(function (l) { if (locaisDe(c).indexOf(l) < 0) c.locaisSis.push(l); });
    invalidarCasos(); save();
    return c;
  }
  function sugerirRegrasModelo() {
    var grupos = {};
    S.sistema.itens.forEach(function (it) {
      var p = norm(it.sn).slice(0, 6);
      if (p.length < 6 || !it.modelo) return;
      grupos[p] = grupos[p] || {};
      grupos[p][it.modelo] = (grupos[p][it.modelo] || 0) + 1;
    });
    return Object.keys(grupos).sort().map(function (p) {
      var ms = grupos[p], melhor = Object.keys(ms).sort(function (a, b) { return ms[b] - ms[a]; })[0];
      return { prefixo: p, modelo: melhor };
    });
  }

  /* ---------- tipos de equipamento ---------- */
  var TIPOS_PADRAO = ['Chromebook', 'Desktop', 'Monitor', 'Óculos Realidade Virtual', 'Assistente Virtual'];
  function tipos() {
    var l = TIPOS_PADRAO.slice();
    function add(t) { t = txt(t); if (t && t !== 'Outro' && l.indexOf(t) < 0) l.push(t); }
    S.sistema.itens.forEach(function (it) { add(it.categoria); });
    S.equipamentos.forEach(function (e) { add(e.tipo); });
    l.push('Outro');
    return l;
  }
  function tipoDe(e) {
    if (e.tipo) return e.tipo;
    var p = conferir().porEq[e.id];
    return p && p.tipo ? p.tipo : 'Chromebook';
  }

  /* ---------- equipamentos ---------- */
  function achaEq(sn) {
    var n = norm(sn);
    if (!n) return [];
    return S.equipamentos.filter(function (e) { return norm(e.sn) === n; });
  }
  function salvarEq(dados) {
    var agora = Date.now(), e;
    if (dados.id) {
      e = S.equipamentos.filter(function (x) { return x.id === dados.id; })[0];
    }
    if (!e) { e = { id: uid(), criado: agora }; S.equipamentos.push(e); }
    ['sn', 'patrimonio', 'carrinho', 'numero', 'modelo', 'obs', 'tipo'].forEach(function (k) { if (k in dados) e[k] = dados[k]; });
    if ('defeitos' in dados) e.defeitos = dados.defeitos.slice();
    e.defeitos = e.defeitos || [];
    e.atualizado = agora;
    invalidarCasos();
    save();
    return e;
  }
  function removerEq(id) {
    S.equipamentos = S.equipamentos.filter(function (e) { return e.id !== id; });
    invalidarCasos(); save();
  }
  function proximoNumero(carrinhoId) {
    var max = 0;
    S.equipamentos.forEach(function (e) {
      if (e.carrinho === carrinhoId) { var n = parseInt(e.numero, 10); if (n > max) max = n; }
    });
    return max + 1;
  }
  function invalidarCasos() { cache = null; }

  /* ---------- conferência ---------- */
  function conferir() {
    if (cache) return cache;
    var eqs = S.equipamentos, ix = indice();
    var res = { casos: [], porEq: {}, sisCasadosPor: {} };
    var usados = {}; // _i do sistema -> lista de eq

    eqs.forEach(function (e) {
      var m = acharSistema(e.sn);
      res.porEq[e.id] = { m: m, estado: !norm(e.sn) ? 'semsn' : m ? 'confere' : 'sem', aviso: '',
        tipo: e.tipo || (m && m.item.categoria) || 'Chromebook' };
      if (m) { (usados[m.item._i] = usados[m.item._i] || []).push(e); }
    });

    var livres = ix.lista.filter(function (it) { return !usados[it._i]; });
    var reclamados = {};
    var c, k;

    function novo(tipo, e, it, titulo, texto, acao) {
      var key = tipo + '|' + (e ? e.id : '') + '|' + (it ? it._n : '');
      var casoSalvo = S.casos[key];
      res.casos.push({ key: key, tipo: tipo, eq: e, sis: it, titulo: titulo, texto: texto, acao: acao,
        resolvido: !!(casoSalvo && casoSalvo.res), nota: casoSalvo ? casoSalvo.nota || '' : '' });
    }
    function nomeEq(e) { return nomeCarrinho(e.carrinho) + (e.numero ? ', nº ' + e.numero : ''); }

    eqs.forEach(function (e) {
      var r = res.porEq[e.id], m = r.m, cart = carrinho(e.carrinho);
      if (!norm(e.sn)) return;
      if (!m) {
        // procura um parecido entre os que sobraram no sistema
        var n = norm(e.sn), melhor = null;
        livres.forEach(function (it) {
          if (reclamados[it._i]) return;
          var d = lev(n, it._n, 2);
          if (d <= 2 && (!melhor || d < melhor.d)) melhor = { it: it, d: d };
        });
        if (melhor) {
          reclamados[melhor.it._i] = true;
          r.estado = 'parecido'; r.parecido = melhor.it;
          novo('provavel_erro', e, melhor.it, 'Provável erro de digitação',
            'O N/S cadastrado (' + e.sn + ') não existe no sistema. O mais parecido é ' + melhor.it.sn + (melhor.it.local ? ' (no sistema está em ' + melhor.it.local + ')' : '') + ', que não foi cadastrado em nenhum outro lugar.',
            'Olhe a etiqueta do equipamento. Se for ' + melhor.it.sn + ', corrija o N/S aqui. Se for o que você digitou, o cadastro do sistema está errado: avise quem mantém o sistema.');
        } else {
          novo('nao_encontrado', e, null, 'N/S não existe no sistema',
            'O N/S ' + e.sn + ' (' + nomeEq(e) + ') não está na exportação do sistema.',
            'Confira a etiqueta para ver se não houve erro de digitação. Se estiver certo, o equipamento não foi cadastrado no sistema: avise quem mantém o sistema.');
        }
        return;
      }
      // casou com o sistema
      if (m.tipo === 'prefixo') r.aviso = 'O cadastro do sistema tem o N/S incompleto (' + m.item.sn + ').';
      if (cart && locaisDe(cart).length && m.item.local && locaisDe(cart).indexOf(m.item.local) < 0) {
        r.estado = 'local';
        novo('local_diferente', e, m.item, 'Local diferente no sistema',
          'O sistema diz que ' + m.item.sn + ' está em "' + m.item.local + '", mas você o cadastrou em "' + cart.nome + '".',
          'Se o equipamento está mesmo em ' + cart.nome + ', atualize a localização no sistema. Se não está, corrija o carrinho aqui.');
      }
    });

    // dois cadastros apontando para o mesmo registro do sistema
    Object.keys(usados).forEach(function (i) {
      var lista = usados[i];
      if (lista.length < 2) return;
      var snsDif = {};
      lista.forEach(function (e) { snsDif[norm(e.sn)] = 1; });
      var it = ix.lista[i];
      if (Object.keys(snsDif).length === 1) {
        novo('duplicado', lista[0], it, 'N/S cadastrado mais de uma vez',
          'O N/S ' + lista[0].sn + ' aparece em ' + lista.length + ' cadastros: ' + lista.map(nomeEq).join('; ') + '.',
          'Veja qual dos cadastros é o certo e apague os outros.');
      } else {
        novo('registro_unico', lista[0], it, 'Dois equipamentos para um registro do sistema',
          lista.map(function (e) { return e.sn + ' (' + nomeEq(e) + ')'; }).join(' e ') + ' correspondem ao mesmo registro do sistema (' + it.sn + ').',
          'Confira as etiquetas. Pode ser que o sistema esteja sem a letra final de um deles, ou que um dos dois não esteja cadastrado no sistema.');
      }
    });

    // no sistema, em carrinho que você cadastrou, mas não cadastrado aqui
    var locaisCarrinhos = mapaLocais();
    livres.forEach(function (it) {
      if (reclamados[it._i]) return;
      var cc = locaisCarrinhos[it.local];
      if (!cc) return;
      novo('a_procurar', null, it, 'Está no sistema, mas não foi cadastrado aqui',
        'O sistema diz que ' + it.sn + (it.modelo ? ' (' + it.modelo + ')' : '') + ' está em "' + cc.nome + '", mas ele não apareceu no seu cadastro.',
        'Procure o equipamento. Se achar em outro carrinho, cadastre lá. Se estiver com alguém, na manutenção ou sumido, registre isso e avise quem mantém o sistema.');
    });

    var ordem = { provavel_erro: 1, nao_encontrado: 2, local_diferente: 3, registro_unico: 4, duplicado: 5, a_procurar: 6 };
    res.casos.sort(function (a, b) { return (ordem[a.tipo] || 9) - (ordem[b.tipo] || 9); });
    res.casos.forEach(function (c) { if (c.eq && res.porEq[c.eq.id]) res.porEq[c.eq.id].caso = c; });
    cache = res;
    return res;
  }
  function resolverCaso(key, resolvido, nota) {
    if (resolvido || nota) S.casos[key] = { res: !!resolvido, nota: nota || '', em: Date.now() };
    else delete S.casos[key];
    invalidarCasos(); save();
  }

  function atencao() {
    var out = [];
    S.equipamentos.forEach(function (e) {
      var d = (e.defeitos || []).map(function (id) { return DEF_POR_ID[id] ? DEF_POR_ID[id].nome : id; });
      if (d.length) out.push({ eq: e, tipo: 'Defeito', texto: d.join(', ') + (e.obs ? '. ' + e.obs : '') });
      if (!txt(e.patrimonio)) out.push({ eq: e, tipo: 'Sem patrimônio', texto: 'Patrimônio não informado.' });
    });
    return out;
  }

  function tipoDeCaso(x) { return x.eq ? tipoDe(x.eq) : ((x.sis && x.sis.categoria) || 'Chromebook'); }
  function grupoDeCaso(t) { return t === 'local_diferente' ? 'sistema' : t === 'a_procurar' ? 'procurar' : 'etiqueta'; }
  /* Números do painel. Com tipoF, só conta aquele tipo de equipamento. */
  function resumo(tipoF) {
    var cf = conferir(), r = { total: 0, confere: 0, semSistema: 0, semSn: 0, ok: 0, ressalva: 0, fora: 0, abertos: 0, resolvidos: 0,
      grupos: { sistema: 0, etiqueta: 0, procurar: 0 }, sisTotal: 0, sisConferidos: 0, porCarrinho: [], porTipo: [], semLigacao: [] };
    var porC = {}, mapa = mapaLocais();
    function novoC(id, nome, tp) { return { id: id, nome: nome, tipo: tp, total: 0, confere: 0, local: 0, parecido: 0, sem: 0, semsn: 0, falta: 0, ok: 0, ressalva: 0, fora: 0, casos: 0 }; }
    S.carrinhos.forEach(function (c) { porC[c.id] = novoC(c.id, c.nome, c.tipo || 'carrinho'); });
    var semC = novoC('', '(sem carrinho)', 'carrinho');
    S.equipamentos.forEach(function (e) {
      if (tipoF && tipoDe(e) !== tipoF) return;
      var p = cf.porEq[e.id], c = porC[e.carrinho] || semC, u = uso(e), st = p ? p.estado : 'sem';
      r.total++; c.total++; c[u]++; r[u]++;
      if (st === 'confere') { c.confere++; r.confere++; }
      else if (st === 'local') c.local++;
      else if (st === 'parecido') c.parecido++;
      else if (st === 'semsn') { c.semsn++; r.semSn++; }
      else c.sem++;
      if (st === 'sem' || st === 'parecido') r.semSistema++;
    });
    cf.casos.forEach(function (x) {
      if (tipoF && tipoDeCaso(x) !== tipoF) return;
      if (x.resolvido) { r.resolvidos++; return; }
      r.abertos++; r.grupos[grupoDeCaso(x.tipo)]++;
      var c = null;
      if (x.eq) c = porC[x.eq.carrinho] || semC;
      else if (x.sis && mapa[x.sis.local]) c = porC[mapa[x.sis.local].id];
      if (c) { c.casos++; if (x.tipo === 'a_procurar') c.falta++; }
    });
    var casados = {};
    Object.keys(cf.porEq).forEach(function (id) { var m = cf.porEq[id].m; if (m) casados[m.item._i] = 1; });
    S.sistema.itens.forEach(function (it) {
      if (tipoF && (it.categoria || 'Chromebook') !== tipoF) return;
      r.sisTotal++; if (casados[it._i]) r.sisConferidos++;
    });
    var pt = {};
    function gt(t) { return pt[t] || (pt[t] = { tipo: t, cad: 0, sis: 0, confere: 0, casos: 0, fora: 0 }); }
    S.equipamentos.forEach(function (e) { var t = gt(tipoDe(e)), p = cf.porEq[e.id]; t.cad++; if (p && p.estado === 'confere') t.confere++; if (uso(e) === 'fora') t.fora++; });
    S.sistema.itens.forEach(function (it) { gt(it.categoria || 'Chromebook').sis++; });
    cf.casos.forEach(function (x) { if (!x.resolvido) gt(tipoDeCaso(x)).casos++; });
    r.porTipo = tipos().filter(function (t) { return pt[t]; }).map(function (t) { return pt[t]; });
    r.semLigacao = locaisDoSistema().filter(function (l) { return !mapa[l.nome]; });
    var lista = S.carrinhos.filter(function (c) { return (c.tipo || 'carrinho') === 'carrinho'; }).concat(S.carrinhos.filter(function (c) { return c.tipo === 'local'; }));
    r.porCarrinho = lista.map(function (c) { return porC[c.id]; }).filter(function (c) { return !tipoF || c.total || c.falta; });
    if (semC.total) r.porCarrinho.push(semC);
    return r;
  }
  /* Contagem por local e tipo: o que o sistema diz × o que foi cadastrado. */
  function quantidades(tipoF) {
    var linhas = [];
    S.carrinhos.forEach(function (c) {
      var loc = locaisDe(c), sis = {}, cad = {}, sem = {}, ts = [];
      S.sistema.itens.forEach(function (it) { if (loc.indexOf(it.local) >= 0) { var t = it.categoria || 'Chromebook'; sis[t] = (sis[t] || 0) + 1; } });
      S.equipamentos.forEach(function (e) {
        if (e.carrinho !== c.id) return;
        var t = tipoDe(e); cad[t] = (cad[t] || 0) + 1; if (!norm(e.sn)) sem[t] = (sem[t] || 0) + 1;
      });
      Object.keys(sis).concat(Object.keys(cad)).forEach(function (t) { if (ts.indexOf(t) < 0) ts.push(t); });
      ts.forEach(function (t) {
        if (tipoF && t !== tipoF) return;
        linhas.push({ id: c.id, nome: c.nome, tipo: t, sis: loc.length ? (sis[t] || 0) : null, cad: cad[t] || 0, semSn: sem[t] || 0 });
      });
    });
    return linhas;
  }

  /* ---------- importação de planilhas ---------- */
  var CAMPOS_SISTEMA = [
    { id: 'sn', nome: 'Número de série', obrig: true, rx: /(^|[^a-z])(n\/?s|s\/?n)([^a-z]|$)|s[ée]rie|serial|service ?tag/i },
    { id: 'modelo', nome: 'Modelo', rx: /modelo|lote|descri|equipamento|marca/i },
    { id: 'local', nome: 'Local (onde está)', rx: /^local|localiza|setor|sala|carrinho|ambiente|armario|armário/i },
    { id: 'categoria', nome: 'Tipo de equipamento', rx: /sub ?categ|categ|tipo|classe/i },
    { id: 'situacao', nome: 'Situação', rx: /situa|status|estado|condi/i },
    { id: 'patrimonio', nome: 'Patrimônio', rx: /patrim|tombo|tombamento|plaqueta/i }
  ];
  var CAMPOS_MINHA = [
    { id: 'sn', nome: 'Número de série', obrig: true, rx: /(^|[^a-z])(n\/?s|s\/?n)([^a-z]|$)|s[ée]rie|serial|service ?tag/i },
    { id: 'patrimonio', nome: 'Patrimônio', rx: /patrim|tombo|tombamento|plaqueta/i },
    { id: 'carrinho', nome: 'Carrinho ou local', rx: /carrinho|armario|armário|local|kit|sala|grupo|cart/i },
    { id: 'numero', nome: 'Número do computador no carrinho', rx: /^(n[ºo°\.]?|nº|no\.?|num(ero)?|número|item|ordem|#|posi[cç][aã]o|chrome|computador)\s*(do\s*(computador|chrome|chromebook|equipamento))?$/i },
    { id: 'tipo', nome: 'Tipo de equipamento', rx: /^tipo|categ|classe/i },
    { id: 'modelo', nome: 'Modelo', rx: /modelo|marca|descri|equipamento/i },
    { id: 'obs', nome: 'Observações ou defeitos', rx: /obs|defeito|problema|estado|situa|coment|anota/i }
  ];

  function rowsDe(wb, nome) {
    return XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: true });
  }
  function acharCabecalho(rows) {
    var maxn = 0, cont = [], i, j;
    for (i = 0; i < Math.min(rows.length, 25); i++) {
      var n = 0;
      (rows[i] || []).forEach(function (c) { if (typeof c === 'string' && txt(c) && isNaN(Number(txt(c)))) n++; });
      cont.push(n); if (n > maxn) maxn = n;
    }
    if (maxn < 2) return 0;
    for (j = 0; j < cont.length; j++) if (cont[j] >= Math.max(2, Math.ceil(maxn * 0.7))) return j;
    return 0;
  }
  function pareceSerie(v) {
    var t = txt(v).replace(/\s+/g, '');
    return /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9\-]{8,30}$/.test(t);
  }
  function sugerirMapa(rows, hdrIdx, campos) {
    var heads = (rows[hdrIdx] || []).map(txt), mapa = {}, usadas = {};
    campos.forEach(function (c) { mapa[c.id] = -1; });
    campos.forEach(function (c) {
      for (var i = 0; i < heads.length; i++) {
        if (!usadas[i] && heads[i] && c.rx.test(heads[i])) { mapa[c.id] = i; usadas[i] = true; return; }
      }
    });
    if (mapa.sn < 0) {
      var amostra = rows.slice(hdrIdx + 1, hdrIdx + 60), melhor = -1, melhorN = 0;
      for (var col = 0; col < heads.length; col++) {
        if (usadas[col]) continue;
        var n = 0, tot = 0;
        amostra.forEach(function (r) { var v = r && r[col]; if (txt(v)) { tot++; if (pareceSerie(v)) n++; } });
        if (tot >= 3 && n / tot >= 0.6 && n > melhorN) { melhor = col; melhorN = n; }
      }
      if (melhor >= 0) { mapa.sn = melhor; usadas[melhor] = true; }
    }
    return mapa;
  }
  function valores(rows, hdrIdx, col) {
    var m = {};
    rows.slice(hdrIdx + 1).forEach(function (r) { var v = txt(r && r[col]); if (v) m[v] = (m[v] || 0) + 1; });
    return Object.keys(m).sort().map(function (k) { return { v: k, n: m[k] }; });
  }

  function importarSistema(rows, hdrIdx, mapa, categorias, arquivo) {
    var itens = [], semSn = 0, fora = 0, vistos = {}, dup = 0;
    rows.slice(hdrIdx + 1).forEach(function (r) {
      if (!r) return;
      var sn = txt(r[mapa.sn]);
      if (!sn) { if (r.some(function (c) { return txt(c); })) semSn++; return; }
      var cat = mapa.categoria >= 0 ? txt(r[mapa.categoria]) : '';
      if (mapa.categoria >= 0 && categorias && categorias.indexOf(cat) < 0) { fora++; return; }
      var n = norm(sn);
      if (vistos[n]) { dup++; return; }
      vistos[n] = true;
      itens.push({ sn: sn, modelo: mapa.modelo >= 0 ? txt(r[mapa.modelo]) : '', local: mapa.local >= 0 ? txt(r[mapa.local]) : '',
        situacao: mapa.situacao >= 0 ? txt(r[mapa.situacao]) : '', categoria: cat, patrimonio: mapa.patrimonio >= 0 ? txt(r[mapa.patrimonio]) : '' });
    });
    S.sistema = { itens: itens, arquivo: arquivo || '', importadoEm: Date.now() };
    invalidar();
    var regrasNovas = 0, locaisSug = 0;
    if (!S.meta.regrasModelo.length) { S.meta.regrasModelo = sugerirRegrasModelo(); regrasNovas = S.meta.regrasModelo.length; }
    locaisSug = sugerirLocaisDosCarrinhos();
    save();
    return { importados: itens.length, foraDoTipo: fora, semSn: semSn, repetidos: dup, regrasNovas: regrasNovas, locaisSugeridos: locaisSug };
  }

  /* abas: [{nome, rows, hdrIdx}] */
  function importarMinha(abas, mapa, opc) {
    opc = opc || {};
    var novos = 0, atualizados = 0, semSn = 0, carrinhosNovos = 0, jaTinha = S.carrinhos.length;
    abas.forEach(function (aba) {
      var m = aba.mapa || mapa;
      aba.rows.slice(aba.hdrIdx + 1).forEach(function (r) {
        if (!r) return;
        var sn = txt(r[m.sn]);
        if (!sn) { if (r.some(function (c) { return txt(c); })) semSn++; return; }
        var nomeC = m.carrinho >= 0 ? txt(r[m.carrinho]) : '';
        if (!nomeC && opc.abaComoCarrinho) nomeC = aba.nome;
        var c = nomeC ? carrinhoPorNome(nomeC, true) : null;
        var obs = m.obs >= 0 ? txt(r[m.obs]) : '';
        var dados = { sn: sn.replace(/\s+/g, ''), patrimonio: m.patrimonio >= 0 ? txt(r[m.patrimonio]) : '',
          carrinho: c ? c.id : '', numero: m.numero >= 0 ? txt(r[m.numero]) : '',
          modelo: m.modelo >= 0 ? txt(r[m.modelo]) : '', obs: obs, defeitos: defeitosDoTexto(obs), tipo: m.tipo >= 0 ? txt(r[m.tipo]) : '' };
        var ex = achaEq(dados.sn)[0];
        if (!dados.modelo) dados.modelo = modeloPara(dados.sn);
        if (ex) {
          if (!opc.atualizar) return;
          var mudou = false;
          ['patrimonio', 'carrinho', 'numero', 'modelo', 'obs', 'tipo'].forEach(function (k) { if (!txt(ex[k]) && txt(dados[k])) { ex[k] = dados[k]; mudou = true; } });
          if (mudou) { ex.atualizado = Date.now(); atualizados++; }
        } else {
          var e = { id: uid(), criado: Date.now(), atualizado: Date.now(), sn: dados.sn, patrimonio: dados.patrimonio, carrinho: dados.carrinho,
            numero: dados.numero, modelo: dados.modelo, obs: dados.obs, defeitos: dados.defeitos };
          if (dados.tipo) e.tipo = dados.tipo;
          S.equipamentos.push(e); novos++;
        }
      });
    });
    carrinhosNovos = S.carrinhos.length - jaTinha;
    var locaisSug = sugerirLocaisDosCarrinhos();
    invalidarCasos(); save();
    return { novos: novos, atualizados: atualizados, semSn: semSn, carrinhosNovos: carrinhosNovos, locaisSugeridos: locaisSug };
  }

  /* ---------- backup ---------- */
  function gerarBackup() {
    S.meta.ultimoBackup = Date.now(); save();
    var copia = JSON.parse(JSON.stringify(S));
    copia.sistema.itens.forEach(function (it) { delete it._n; delete it._i; });
    return JSON.stringify(copia);
  }
  function mesclarBackup(json) {
    var B;
    try { B = JSON.parse(json); } catch (e) { throw new Error('O arquivo não é um backup válido.'); }
    if (!B || !B.equipamentos || !B.carrinhos || !B.sistema) throw new Error('O arquivo não parece ser um backup deste aplicativo.');
    var rel = { novos: 0, atualizados: 0, mantidos: 0, carrinhosNovos: 0 };
    var mapaC = {};
    B.carrinhos.forEach(function (c) {
      var ex = carrinhoPorNome(c.nome, false);
      var ls = c.locaisSis || (c.localSistema ? [c.localSistema] : []);
      if (!ex) { ex = { id: uid(), nome: c.nome, tipo: c.tipo || 'carrinho', locaisSis: ls.slice() }; S.carrinhos.push(ex); rel.carrinhosNovos++; }
      else if (!locaisDe(ex).length && ls.length) ex.locaisSis = ls.slice();
      mapaC[c.id] = ex.id;
    });
    B.equipamentos.forEach(function (be) {
      var ex = norm(be.sn) ? achaEq(be.sn)[0] : S.equipamentos.filter(function (x) { return x.id === be.id; })[0];
      var novo = { sn: be.sn || '', patrimonio: be.patrimonio || '', carrinho: mapaC[be.carrinho] || '', numero: be.numero || '', modelo: be.modelo || '',
        obs: be.obs || '', defeitos: be.defeitos || [], tipo: be.tipo || '' };
      if (!ex) {
        var idLivre = be.id && !S.equipamentos.some(function (x) { return x.id === be.id; });
        S.equipamentos.push({ id: idLivre ? be.id : uid(), criado: be.criado || Date.now(), atualizado: be.atualizado || Date.now(), sn: novo.sn, patrimonio: novo.patrimonio,
          carrinho: novo.carrinho, numero: novo.numero, modelo: novo.modelo, obs: novo.obs, defeitos: novo.defeitos, tipo: novo.tipo });
        rel.novos++;
      } else if ((be.atualizado || 0) > (ex.atualizado || 0)) {
        Object.keys(novo).forEach(function (k) { ex[k] = novo[k]; });
        ex.atualizado = be.atualizado; rel.atualizados++;
      } else rel.mantidos++;
    });
    if ((B.sistema.importadoEm || 0) > (S.sistema.importadoEm || 0) && B.sistema.itens.length) { S.sistema = B.sistema; invalidar(); }
    Object.keys(B.casos || {}).forEach(function (k) { if (!S.casos[k] || (B.casos[k].em || 0) > (S.casos[k].em || 0)) S.casos[k] = B.casos[k]; });
    if (!S.meta.escola && B.meta && B.meta.escola) S.meta.escola = B.meta.escola;
    if (!S.meta.regrasModelo.length && B.meta && B.meta.regrasModelo) S.meta.regrasModelo = B.meta.regrasModelo;
    invalidarCasos(); save();
    return rel;
  }

  /* ---------- exportação para planilha ---------- */
  function planilhasParaExportar() {
    var cf = conferir(), r = resumo(), tem = !!S.sistema.itens.length;
    var res = [['Inventário', S.meta.escola || ''], ['Gerado em', new Date().toLocaleString('pt-BR')], [],
      ['Equipamentos cadastrados', r.total], ['No sistema', r.sisTotal], ['Conferem com o sistema', r.confere], ['Casos abertos', r.abertos], ['Casos resolvidos', r.resolvidos],
      ['Usáveis', r.ok + r.ressalva], ['Fora de uso', r.fora], [], ['Tipo', 'Cadastrados', 'No sistema', 'Conferem', 'Casos abertos', 'Fora de uso']];
    r.porTipo.forEach(function (t) { res.push([t.tipo, t.cad, t.sis, t.confere, t.casos, t.fora]); });
    res.push([], ['Carrinho ou local', 'Cadastrados', 'Conferem', 'Usáveis', 'Fora de uso', 'Casos abertos']);
    r.porCarrinho.forEach(function (c) { res.push([c.nome, c.total, c.confere, c.ok + c.ressalva, c.fora, c.casos]); });
    var qt = [['Carrinho ou local', 'Tipo', 'No sistema', 'Cadastrados', 'Diferença (cadastrados - sistema)', 'Sem N/S']];
    quantidades().forEach(function (q) { qt.push([q.nome, q.tipo, q.sis == null ? 'sem ligação' : q.sis, q.cad, q.sis == null ? '' : q.cad - q.sis, q.semSn]); });
    var NOMEUSO = { ok: 'Usável', ressalva: 'Usável, com defeito', fora: 'Fora de uso' };
    var eq = [['Carrinho ou local', 'Nº', 'Tipo', 'N/S', 'Patrimônio', 'Modelo', 'Estado', 'Defeitos', 'Observação', 'Situação na conferência', 'Local no sistema']];
    S.equipamentos.slice().sort(function (a, b) { return nomeCarrinho(a.carrinho).localeCompare(nomeCarrinho(b.carrinho), 'pt-BR') || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0); })
      .forEach(function (e) {
        var p = cf.porEq[e.id], est = !tem ? '' : p && p.estado === 'semsn' ? 'Sem N/S (conta por quantidade)' : p && p.estado === 'confere' ? 'Confere' : p && p.estado === 'local' ? 'Local diferente' : p && p.estado === 'parecido' ? 'Provável erro de digitação' : 'Não existe no sistema';
        eq.push([nomeCarrinho(e.carrinho), e.numero || '', tipoDe(e), e.sn || '(sem N/S)', e.patrimonio || '', e.modelo || '', NOMEUSO[uso(e)],
          (e.defeitos || []).map(function (id) { return DEF_POR_ID[id] ? DEF_POR_ID[id].nome : id; }).join(', '), e.obs || '', est, p && p.m ? p.m.item.local : '']);
      });
    var ca = [['Situação', 'Tipo', 'Carrinho', 'Nº', 'N/S cadastrado', 'N/S no sistema', 'Local no sistema', 'O que aconteceu', 'O que fazer', 'Anotação']];
    cf.casos.forEach(function (c) {
      ca.push([c.resolvido ? 'Resolvido' : 'Aberto', c.titulo, c.eq ? nomeCarrinho(c.eq.carrinho) : '', c.eq ? c.eq.numero || '' : '', c.eq ? c.eq.sn : '',
        c.sis ? c.sis.sn : '', c.sis ? c.sis.local : '', c.texto, c.acao, c.nota]);
    });
    var at = [['Atualizar no sistema', 'N/S', 'Local atual no sistema', 'Onde está de verdade', 'Observação']];
    cf.casos.forEach(function (c) {
      if (c.resolvido) return;
      if (c.tipo === 'local_diferente') at.push(['Mudar a localização', c.sis.sn, c.sis.local, c.eq ? nomeCarrinho(c.eq.carrinho) : '', '']);
      else if (c.tipo === 'nao_encontrado') at.push(['Cadastrar no sistema', c.eq.sn, '', nomeCarrinho(c.eq.carrinho), c.eq.modelo || '']);
      else if (c.tipo === 'a_procurar') at.push(['Procurar o equipamento', c.sis.sn, c.sis.local, '', 'Está no sistema, mas não foi encontrado']);
      else if (c.tipo === 'provavel_erro') at.push(['Conferir etiqueta (provável erro de digitação)', c.sis.sn, c.sis.local, nomeCarrinho(c.eq.carrinho), 'Cadastrado aqui como ' + c.eq.sn]);
    });
    var atn = [['Tipo', 'Carrinho', 'Nº', 'N/S', 'Patrimônio', 'Detalhe']];
    atencao().forEach(function (a) { atn.push([a.tipo, nomeCarrinho(a.eq.carrinho), a.eq.numero || '', a.eq.sn || '(sem N/S)', a.eq.patrimonio || '', a.texto]); });
    return [['Resumo', res], ['Equipamentos', eq], ['Quantidades', qt], ['Conferência', ca], ['Atualizar no sistema', at], ['Atenção', atn]];
  }
  function exportarXlsx(nomeArquivo) {
    var wb = XLSX.utils.book_new();
    planilhasParaExportar().forEach(function (p) {
      var ws = XLSX.utils.aoa_to_sheet(p[1]);
      var larg = [];
      p[1].forEach(function (row) { row.forEach(function (c, i) { var l = String(c == null ? '' : c).length; larg[i] = Math.min(60, Math.max(larg[i] || 8, l + 2)); }); });
      ws['!cols'] = larg.map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, p[0]);
    });
    XLSX.writeFile(wb, nomeArquivo || 'inventario.xlsx');
  }

  INV.load = load; INV.save = save; INV.saveNow = saveNow; INV.zerar = zerar;
  INV.norm = norm; INV.txt = txt; INV.semAcento = semAcento; INV.uid = uid;
  INV.DEFEITOS = DEFEITOS; INV.DEF_POR_ID = DEF_POR_ID;
  INV.carrinho = carrinho; INV.carrinhoPorNome = carrinhoPorNome; INV.nomeCarrinho = nomeCarrinho;
  INV.modeloPara = modeloPara; INV.uso = uso; INV.acharSistema = acharSistema; INV.achaEq = achaEq;
  INV.salvarEq = salvarEq; INV.removerEq = removerEq; INV.proximoNumero = proximoNumero;
  INV.conferir = conferir; INV.resolverCaso = resolverCaso; INV.atencao = atencao; INV.resumo = resumo;
  INV.locaisDoSistema = locaisDoSistema; INV.sugerirLocal = sugerirLocal; INV.sugerirLocaisDosCarrinhos = sugerirLocaisDosCarrinhos;
  INV.locaisDe = locaisDe; INV.sugerirLocaisSis = sugerirLocaisSis; INV.sugerirLocaisNovos = sugerirLocaisNovos; INV.criarLocal = criarLocal; INV.mapaLocais = mapaLocais;
  INV.tipos = tipos; INV.tipoDe = tipoDe; INV.quantidades = quantidades; INV.grupoDeCaso = grupoDeCaso; INV.tipoDeCaso = tipoDeCaso;
  INV.sugerirRegrasModelo = sugerirRegrasModelo; INV.invalidar = invalidar; INV.invalidarCasos = invalidarCasos;
  INV.CAMPOS_SISTEMA = CAMPOS_SISTEMA; INV.CAMPOS_MINHA = CAMPOS_MINHA;
  INV.rowsDe = rowsDe; INV.acharCabecalho = acharCabecalho; INV.sugerirMapa = sugerirMapa; INV.valores = valores;
  INV.importarSistema = importarSistema; INV.importarMinha = importarMinha;
  INV.gerarBackup = gerarBackup; INV.mesclarBackup = mesclarBackup; INV.exportarXlsx = exportarXlsx;
  g.INV = INV;
})(window);
