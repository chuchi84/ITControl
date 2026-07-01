// ═══════════════════════════════════════════════════════════════════════
//  ITControl Pro — Google Apps Script Backend v2.0
//  Sheet: 1MXWlVfOETOXvaqxI7evb3_ic0v3w0d4s0udogUhJdkU
//  Cambios v2.0: agrega Bajas, Mantenimiento, Soporte, Inventario, Accesorios
// ═══════════════════════════════════════════════════════════════════════

const SHEET_ID = '1MXWlVfOETOXvaqxI7evb3_ic0v3w0d4s0udogUhJdkU';

const HOJAS = {
  empresas:      'Empresas',
  equipos:       'Equipos',
  compras:       'Compras',
  historial:     'Historial',
  asignaciones:  'Asignaciones',
  licencias:     'Licencias',
  tareas:        'Tareas',
  usuarios:      'Usuarios',
  log:           'Log',
  acceso:        'Acceso',
  bajas:         'Bajas',
  programas_mant:'ProgramasMantenimiento',
  solicitudes_soporte: 'SolicitudesSoporte',
  sesiones_inventario: 'SesionesInventario',
  accesorios:    'Accesorios',
};

const COLS = {
  empresas:     ['id','name','rut','prefix','counter','giro','contacto','email','tel','dir','sedes'],
  equipos:      ['id','co','local_id','area','compra_id','tipo','marca','modelo','serie','estado','specs','campos','software','comentarios','garantia','baja_id','baja_fecha','baja_motivo'],
  compras:      ['id','co','local_id','proveedor','rut_prov','tipo_doc','num_doc','fecha','financiador','quien_pago','forma_pago','monto','estado_pago','metodo_pago','fecha_pago','cobrado_cliente','descripcion','area','equipos_ids','adjunto','adjunto_nombre'],
  historial:    ['id','eq_id','co','local_id','tipo','fecha','tecnico','costo','desc','prox'],
  asignaciones: ['id','eq_id','co','sede_id','ubicacion','persona','cargo','fecha','fecha_dev','estado','obs','firma'],
  licencias:    ['id','co','software','version','tipo','licencia','vencimiento','equipos','notas'],
  tareas:       ['id','co','titulo','desc','estado','prioridad','asignado','fecha_limite','eq_id','creado'],
  usuarios:     ['id','co','nombre','email','rol','password','activo'],
  log:          ['id','co','usuario','accion','modulo','detalle','fecha'],
  acceso:       ['email','nombre','rol','fecha_agregado'],
  bajas:        ['id','eq_id','co','marca','modelo','tipo','serie','motivo','fecha','destino','autoriza','estado_anterior','registrado_en'],
  programas_mant:['id','co','eq_id','tipo_mant','frecuencia','ultima','proxima','notas','creado'],
  solicitudes_soporte:['id','co','nombre','email','equipo_id','titulo','prioridad','desc','estado','fecha','respuesta','tomado_en','resuelto_en','tarea_id'],
  sesiones_inventario:['id','co','fecha','estado','sede_filtro','area_filtro','total','eq_scope','encontrados','discrepancias','no_encontrados','iniciado_en','cerrado_en'],
  accesorios:   ['id','eq_padre','co','tipo','marca','modelo','serie','estado','notas','creado'],
};

// ── ENTRY POINT ──────────────────────────────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    const params = e.parameter || {};
    let body = {};
    if (e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch(pe) {}
    } else if (params.body) {
      try { body = JSON.parse(params.body); } catch(pe) {}
    }

    const action = params.action || body.action;
    const token  = params.token  || body.token;
    Logger.log('ITControl action: ' + action);

    // Ping — sin auth
    if (action === 'ping') return jsonResponse({ ok: true, version: '2.0', app: 'ITControl Pro' });

    // Acceso — solo necesita token
    if (action === 'acceso') return jsonResponse(getAcceso(token));

    // Todo lo demás requiere auth
    const user = getUserFromToken(token);
    if (!user) return jsonResponse({ ok: false, error: 'No autorizado' });

    switch (action) {

      case 'load':
        return jsonResponse(loadAll(user));

      case 'save':
        return jsonResponse(saveConfig(body.data, user));

      // ── EQUIPOS ──
      case 'equipo_add':
        return jsonResponse(addRow(HOJAS.equipos, COLS.equipos, body.equipo, user));
      case 'equipo_edit':
        return jsonResponse(editRow(HOJAS.equipos, COLS.equipos, body.equipo, user));
      case 'equipo_del':
        return jsonResponse(delRow(HOJAS.equipos, COLS.equipos, body.id, user));

      // ── COMPRAS ──
      case 'compra_add':
        return jsonResponse(addRow(HOJAS.compras, COLS.compras, body.compra, user));
      case 'compra_edit':
        return jsonResponse(editRow(HOJAS.compras, COLS.compras, body.compra, user));
      case 'compra_del':
        return jsonResponse(delRow(HOJAS.compras, COLS.compras, body.id, user));

      // ── HISTORIAL ──
      case 'historial_add':
        return jsonResponse(addRow(HOJAS.historial, COLS.historial, body.evento, user));
      case 'historial_del':
        return jsonResponse(delRow(HOJAS.historial, COLS.historial, body.id, user));

      // ── ASIGNACIONES ──
      case 'asignacion_add':
        return jsonResponse(addRow(HOJAS.asignaciones, COLS.asignaciones, body.asignacion, user));
      case 'asignacion_edit':
        return jsonResponse(editRow(HOJAS.asignaciones, COLS.asignaciones, body.asignacion, user));
      case 'asignacion_del':
        return jsonResponse(delRow(HOJAS.asignaciones, COLS.asignaciones, body.id, user));

      // ── EMPRESAS ──
      case 'empresa_save':
        return jsonResponse(saveEmpresa(body.empresa, user));

      // ── TAREAS ──
      case 'tarea_add':
        return jsonResponse(addRow(HOJAS.tareas, COLS.tareas, body.tarea, user));
      case 'tarea_edit':
        return jsonResponse(editRow(HOJAS.tareas, COLS.tareas, body.tarea, user));
      case 'tarea_del':
        return jsonResponse(delRow(HOJAS.tareas, COLS.tareas, body.id, user));

      // ── LICENCIAS ──
      case 'licencia_add':
        return jsonResponse(addRow(HOJAS.licencias, COLS.licencias, body.licencia, user));
      case 'licencia_edit':
        return jsonResponse(editRow(HOJAS.licencias, COLS.licencias, body.licencia, user));
      case 'licencia_del':
        return jsonResponse(delRow(HOJAS.licencias, COLS.licencias, body.id, user));

      // ── BAJAS ──
      case 'baja_add':
        return jsonResponse(addRow(HOJAS.bajas, COLS.bajas, body.baja, user));

      // ── MANTENIMIENTO PREVENTIVO ──
      case 'programa_mant_add':
        return jsonResponse(addRow(HOJAS.programas_mant, COLS.programas_mant, body.programa, user));
      case 'programa_mant_edit':
        return jsonResponse(editRow(HOJAS.programas_mant, COLS.programas_mant, body.programa, user));
      case 'programa_mant_del':
        return jsonResponse(delRow(HOJAS.programas_mant, COLS.programas_mant, body.id, user));

      // ── SOPORTE EXTERNO ──
      // NOTA: solicitud_add NO requiere auth normalmente (viene del portal público)
      // pero aquí queda protegida; el portal público debe usar 'solicitud_publica'
      case 'solicitud_add':
        return jsonResponse(addRow(HOJAS.solicitudes_soporte, COLS.solicitudes_soporte, body.solicitud, user));
      case 'solicitud_edit':
        return jsonResponse(editRow(HOJAS.solicitudes_soporte, COLS.solicitudes_soporte, body.solicitud, user));

      // ── INVENTARIO FÍSICO ──
      case 'sesion_inv_add':
        return jsonResponse(addRow(HOJAS.sesiones_inventario, COLS.sesiones_inventario, body.sesion, user));
      case 'sesion_inv_edit':
        return jsonResponse(editRow(HOJAS.sesiones_inventario, COLS.sesiones_inventario, body.sesion, user));

      // ── ACCESORIOS ──
      case 'accesorio_add':
        return jsonResponse(addRow(HOJAS.accesorios, COLS.accesorios, body.accesorio, user));
      case 'accesorio_del':
        return jsonResponse(delRow(HOJAS.accesorios, COLS.accesorios, body.id, user));

      // ── NOTIFICACIONES EMAIL ──
      case 'email_notify':
        return jsonResponse(enviarEmailNotificacion(body.tipo, body.datos, user));

      // ── LOG ──
      case 'log_add':
        return jsonResponse(addLog(body.entrada, user));

      default:
        return jsonResponse({ ok: false, error: 'Acción desconocida: ' + action });
    }
  } catch(err) {
    Logger.log('Error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── PORTAL PÚBLICO DE SOPORTE (sin auth) ──────────────────────────────
// Acción especial fuera del switch principal porque no requiere login
function handlePublicRequest(action, body) {
  if (action === 'solicitud_publica') {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = getOrCreateSheet(ss, HOJAS.solicitudes_soporte, COLS.solicitudes_soporte);
    const solic = body.solicitud;
    if (!solic || !solic.nombre || !solic.email) {
      return { ok: false, error: 'Datos incompletos' };
    }
    if (!solic.id) solic.id = 'S-' + Date.now();
    solic.estado = 'pendiente';
    solic.fecha = solic.fecha || new Date().toISOString();
    const row = COLS.solicitudes_soporte.map(col => {
      const v = solic[col];
      return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
    });
    ensureRows(sh, 50);
    sh.appendRow(row);
    return { ok: true, id: solic.id };
  }
  return { ok: false, error: 'Acción pública desconocida' };
}

// ── AUTH ─────────────────────────────────────────────────
function getEmailFromToken(token) {
  if (!token) return null;
  // Primero: verificar con Google (más seguro)
  try {
    const res = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const info = JSON.parse(res.getContentText());
    if (info.email) return info.email;
  } catch(e) { Logger.log('userinfo error: ' + e.message); }
  // Fallback: decodificar JWT
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString());
      if (payload.email) return payload.email;
    }
  } catch(e) { Logger.log('JWT decode error: ' + e.message); }
  return null;
}

function getUserFromToken(token) {
  const email = getEmailFromToken(token);
  if (!email) return null;
  return checkAccesoEmail(email);
}

function checkAccesoEmail(email) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(HOJAS.acceso);
  if (!sh) return null;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0]||'').toLowerCase().trim() === (email||'').toLowerCase().trim()) {
      return { email: rows[i][0], nombre: rows[i][1], rol: rows[i][2] };
    }
  }
  return null;
}

function getAcceso(token) {
  try {
    const email = getEmailFromToken(token);
    if (!email) return { ok: false, error: 'No se pudo obtener email del token' };
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(HOJAS.acceso);
    const rows = sh ? sh.getDataRange().getValues() : [];
    const lista = rows.slice(1).map(r => ({ email: r[0], nombre: r[1], rol: r[2] }));
    const user  = lista.find(u => (u.email||'').toLowerCase().trim() === email.toLowerCase().trim());
    if (!user) return { ok: false, error: 'Email no autorizado: ' + email };
    return { ok: true, user };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── LOAD ALL ─────────────────────────────────────────────────────────
function loadAll(user) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return {
    ok:           true,
    user,
    empresas:     loadEmpresas(ss),
    equipos:      sheetToArray(ss, HOJAS.equipos,      COLS.equipos),
    compras:      sheetToArray(ss, HOJAS.compras,      COLS.compras),
    historial:    sheetToArray(ss, HOJAS.historial,    COLS.historial),
    asignaciones: sheetToArray(ss, HOJAS.asignaciones, COLS.asignaciones),
    licencias:    sheetToArray(ss, HOJAS.licencias,    COLS.licencias),
    tareas:       sheetToArray(ss, HOJAS.tareas,       COLS.tareas),
    usuarios:     sheetToArray(ss, HOJAS.usuarios,     COLS.usuarios),
    bajas:                sheetToArray(ss, HOJAS.bajas,                COLS.bajas),
    programas_mant:       sheetToArray(ss, HOJAS.programas_mant,       COLS.programas_mant),
    solicitudes_soporte:  sheetToArray(ss, HOJAS.solicitudes_soporte,  COLS.solicitudes_soporte),
    sesiones_inventario:  sheetToArray(ss, HOJAS.sesiones_inventario,  COLS.sesiones_inventario),
    accesorios:           sheetToArray(ss, HOJAS.accesorios,           COLS.accesorios),
  };
}

// ── SAVE CONFIG ───────────────────────────────────────────────────────
function saveConfig(data, user) {
  if (!data) return { ok: false, error: 'Sin datos' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (data.empresas)  saveEmpresas(ss, data.empresas);
  if (data.licencias) arrayToSheet(ss, HOJAS.licencias, COLS.licencias, data.licencias);
  if (data.tareas)    arrayToSheet(ss, HOJAS.tareas,    COLS.tareas,    data.tareas);
  if (data.usuarios)  arrayToSheet(ss, HOJAS.usuarios,  COLS.usuarios,  data.usuarios);
  return { ok: true };
}

// ── EMPRESA OPS ───────────────────────────────────────────────────────
function loadEmpresas(ss) {
  const sh = ss.getSheetByName(HOJAS.empresas);
  if (!sh || sh.getLastRow() <= 1) return {};
  const obj = {};
  sh.getDataRange().getValues().slice(1)
    .filter(r => r[0])
    .forEach(r => {
      const emp = {};
      COLS.empresas.forEach((col, i) => {
        let v = r[i];
        if (col === 'sedes' || col === 'specs' || col === 'campos') {
          if (typeof v === 'string' && v) { try { v = JSON.parse(v); } catch(e) { v = []; } }
          else v = [];
        }
        emp[col] = v;
      });
      if (!Array.isArray(emp.sedes)) emp.sedes = [];
      obj[emp.id] = emp;
    });
  return obj;
}

function saveEmpresas(ss, empresas) {
  const sh = getOrCreateSheet(ss, HOJAS.empresas, COLS.empresas);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  const rows = Object.values(empresas).map(emp =>
    COLS.empresas.map(col => {
      const v = emp[col];
      if (col === 'sedes') return JSON.stringify(v || []);
      return v !== undefined ? v : '';
    })
  );
  if (rows.length) {
    ensureRows(sh, rows.length + 50);
    sh.getRange(2, 1, rows.length, COLS.empresas.length).setValues(rows);
  }
}

function saveEmpresa(empresa, user) {
  if (!empresa || !empresa.id) return { ok: false, error: 'Sin ID' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const empresas = loadEmpresas(ss);
  empresas[empresa.id] = empresa;
  saveEmpresas(ss, empresas);
  return { ok: true };
}

// ── CRUD GENÉRICO ─────────────────────────────────────────────────────
function addRow(hoja, cols, data, user) {
  if (!data) return { ok: false, error: 'Sin datos' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = getOrCreateSheet(ss, hoja, cols);
  if (!data.id) data.id = hoja.slice(0,3).toUpperCase() + '-' + Date.now();
  const row = cols.map(col => {
    const v = data[col];
    return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
  });
  ensureRows(sh, 100);
  sh.appendRow(row);
  return { ok: true, id: data.id };
}

function editRow(hoja, cols, data, user) {
  if (!data || !data.id) return { ok: false, error: 'Sin ID' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(hoja);
  if (!sh) return addRow(hoja, cols, data, user);
  const rows = sh.getDataRange().getValues();
  const idCol = cols.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      const row = cols.map(col => {
        const v = data[col];
        return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
      });
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { ok: true };
    }
  }
  return addRow(hoja, cols, data, user);
}

function delRow(hoja, cols, id, user) {
  if (!id) return { ok: false, error: 'Sin ID' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(hoja);
  if (!sh) return { ok: false, error: 'Hoja no existe' };
  const rows = sh.getDataRange().getValues();
  const idCol = cols.indexOf('id');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]) === String(id)) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No encontrado' };
}

function addLog(entrada, user) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = getOrCreateSheet(ss, HOJAS.log, COLS.log);
  ensureRows(sh, 50);
  sh.appendRow([
    Date.now(), entrada.co || '', user.email,
    entrada.accion || '', entrada.modulo || '',
    entrada.detalle || '', new Date().toISOString()
  ]);
  return { ok: true };
}

// ── NOTIFICACIONES EMAIL ───────────────────────────────────────────────
function enviarEmailNotificacion(tipo, datos, user) {
  if (!datos || !datos.email) return { ok: false, error: 'Sin email destino' };

  let asunto = '', cuerpo = '';
  const empresa = datos.empresa || '';

  switch (tipo) {
    case 'prueba':
      asunto = '[ITControl Pro] Notificación de prueba — ' + empresa;
      cuerpo = 'Esta es una notificación de prueba desde ITControl Pro.\n\n'
             + 'Empresa: ' + empresa + '\n'
             + 'Enviado por: ' + (user.nombre || user.email) + '\n'
             + 'Fecha: ' + new Date().toLocaleString('es-CL');
      break;

    case 'alertas':
      asunto = '[ITControl Pro] ' + (datos.alertas||[]).length + ' alertas activas — ' + empresa;
      cuerpo = 'Resumen de alertas para ' + empresa + ':\n\n'
             + (datos.alertas||[]).map(a => '• [' + a.nivel.toUpperCase() + '] ' + a.titulo + ' — ' + a.det).join('\n');
      break;

    case 'garantias':
      asunto = '[ITControl Pro] Garantías próximas a vencer — ' + empresa;
      cuerpo = 'Equipos con garantía próxima a vencer en ' + empresa + ':\n\n'
             + (datos.equipos||[]).map(e =>
                 '• ' + e.id + ' — ' + e.marca + ' ' + e.modelo +
                 ' — Vence: ' + e.garantia + ' (' + (e.dias<0?'VENCIDA':e.dias+' días') + ')'
               ).join('\n');
      break;

    case 'mantenimiento':
      asunto = '[ITControl Pro] Mantenciones programadas — ' + empresa;
      cuerpo = 'Programas de mantención preventiva en ' + empresa + ':\n\n'
             + (datos.programas||[]).map(p =>
                 '• ' + p.eq_id + ' — ' + p.tipo_mant + ' — Próxima: ' + (p.proxima||'sin fecha')
               ).join('\n');
      break;

    case 'soporte':
      asunto = '[ITControl Pro] ' + (datos.solicitudes||[]).length + ' solicitudes de soporte pendientes — ' + empresa;
      cuerpo = 'Solicitudes de soporte pendientes en ' + empresa + ':\n\n'
             + (datos.solicitudes||[]).map(s =>
                 '• ' + s.titulo + ' — ' + s.nombre + ' (' + s.email + ') — Prioridad: ' + s.prioridad
               ).join('\n');
      break;

    default:
      return { ok: false, error: 'Tipo de notificación desconocido' };
  }

  try {
    MailApp.sendEmail({
      to: datos.email,
      subject: asunto,
      body: cuerpo,
    });
    return { ok: true };
  } catch(e) {
    Logger.log('Email error: ' + e.message);
    return { ok: false, error: 'Error enviando email: ' + e.message };
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────
function sheetToArray(ss, nombre, cols) {
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() <= 1) return [];
  return sh.getDataRange().getValues().slice(1)
    .filter(row => row.some(c => c !== '' && c !== null && c !== undefined))
    .map(row => {
      const obj = {};
      cols.forEach((col, i) => {
        let v = row[i];
        if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
          try { v = JSON.parse(v); } catch(e) {}
        }
        obj[col] = v;
      });
      return obj;
    });
}

function arrayToSheet(ss, nombre, cols, data) {
  const sh = getOrCreateSheet(ss, nombre, cols);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (!data || !data.length) return;
  const rows = data.map(obj => cols.map(col => {
    const v = obj[col];
    return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
  }));
  ensureRows(sh, rows.length + 50);
  sh.getRange(2, 1, rows.length, cols.length).setValues(rows);
}

function ensureRows(sh, minFree) {
  try {
    const free = sh.getMaxRows() - sh.getLastRow();
    if (free < minFree) sh.insertRowsAfter(sh.getMaxRows(), minFree - free + 200);
  } catch(e) { Logger.log('ensureRows error: ' + e.message); }
}

function getOrCreateSheet(ss, nombre, cols) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length)
      .setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SETUP INICIAL ─────────────────────────────────────────────────────
// Ejecutar una vez para crear todas las hojas y agregar al titular
// También se puede re-ejecutar para crear las hojas NUEVAS sin afectar las existentes
function setupInicial() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.entries(COLS).forEach(([nombre, cols]) => {
    const hoja = HOJAS[nombre] || nombre;
    getOrCreateSheet(ss, hoja, cols);
    Logger.log('OK: ' + hoja);
  });
  // Agregar titular
  const shAcceso = ss.getSheetByName(HOJAS.acceso);
  const email = 'mciappaf@gmail.com';
  const rows = shAcceso.getDataRange().getValues();
  if (!rows.slice(1).some(r => r[0] === email)) {
    shAcceso.appendRow([email, 'Cristóbal', 'titular', new Date().toISOString()]);
    Logger.log('✅ Titular agregado: ' + email);
  }
  Logger.log('✅ ITControl Pro v2.0 setup completado');
}
