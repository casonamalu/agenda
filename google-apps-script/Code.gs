const CASONA_SYNC_URL = 'https://qaguhjvphiaefsporxgu.supabase.co/functions/v1/google-drive-sync';
const CONTROL_SHEET = 'SINCRONIZACIÓN';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Casona Malú')
    .addItem('Autorizar controles', 'autorizarControles')
    .addSeparator()
    .addItem('Actualizar Excel', 'actualizarExcel')
    .addItem('Cargar Excel al sistema', 'cargarExcel')
    .addToUi();
}

function autorizarControles() {
  const status = callSync_('status');
  writeResult_('Controles autorizados para esta administradora.');
  SpreadsheetApp.getUi().alert(
    status.configured
      ? 'Autorización completada. Ya puedes usar Actualizar Excel y Cargar Excel al sistema.'
      : 'La cuenta quedó autorizada, pero la conexión técnica de Google aún no está configurada.'
  );
}

function actualizarExcel() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = callSync_('push');
    const message = `Actualización completada: ${result.exported || 0} citas no canceladas.`;
    writeResult_(message);
    SpreadsheetApp.getActive().toast(message, 'Casona Malú', 6);
  } catch (error) {
    showError_(error);
  }
}

function cargarExcel() {
  const ui = SpreadsheetApp.getUi();
  try {
    const preview = callSync_('preview');
    const summary = preview.summary || {};
    const changes = (summary.create || 0) + (summary.update || 0) + (summary.cancel || 0) + (summary.no_show || 0);
    if (summary.error) {
      const message = `No se puede cargar: existen ${summary.error} fila(s) con error. Corrígelas desde REGISTRO.`;
      writeResult_(message);
      ui.alert(message);
      return;
    }
    if (!changes) {
      const message = 'No existen cambios para cargar al sistema.';
      writeResult_(message);
      ui.alert(message);
      return;
    }
    const detail = [
      `${summary.create || 0} nuevas`,
      `${summary.update || 0} actualizadas`,
      `${(summary.cancel || 0) + (summary.no_show || 0)} bajas`,
      `${summary.overbook || 0} sobrecupos`,
    ].join(' · ');
    const answer = ui.alert(
      'Confirmar carga',
      `${detail}\n\nEsta acción puede generar correos normales de agendamiento o reprogramación. ¿Deseas continuar?`,
      ui.ButtonSet.YES_NO
    );
    if (answer !== ui.Button.YES) return;
    const result = callSync_('apply');
    const message = `Carga completada: ${result.created || 0} creadas, ${result.updated || 0} actualizadas y ${(result.errors || []).length} errores.`;
    writeResult_(message);
    ui.alert(message);
  } catch (error) {
    showError_(error);
  }
}

function callSync_(action) {
  const response = UrlFetchApp.fetch(CASONA_SYNC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${ScriptApp.getOAuthToken()}`,
      'X-Google-Apps-Script': '1',
    },
    payload: JSON.stringify({ action }),
    muteHttpExceptions: true,
  });
  const text = response.getContentText();
  let payload = {};
  try { payload = JSON.parse(text); } catch (error) { payload = { error: text }; }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || payload.error) {
    throw new Error(payload.error || `Error HTTP ${response.getResponseCode()}`);
  }
  return payload;
}

function writeResult_(message) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONTROL_SHEET);
  if (sheet) {
    sheet.getRange('A11:G11').merge();
    sheet.getRange('A11').setValue(`${new Date().toLocaleString('es-CL')} · ${message}`);
  }
}

function showError_(error) {
  const message = error && error.message ? error.message : String(error);
  writeResult_(`ERROR: ${message}`);
  SpreadsheetApp.getUi().alert(`No se pudo completar la sincronización:\n${message}`);
}