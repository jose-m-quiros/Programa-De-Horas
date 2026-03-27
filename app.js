/* ============================================
   Control de Horas - App v4
   + Sistema de backups automáticos
   + Protección contra pérdida de datos
   + Panel de tarifas
   ============================================ */

// ==========================================
// Configuración de empleados
// ==========================================
const EMPLOYEES = [
  {
    id: "boss",
    name: "Omar",
    role: "Jefe",
    rate: 4800,
    emoji: "👔",
    isBoss: true,
  },
  {
    id: "employee1",
    name: "Alvaro",
    role: "Trabajador",
    rate: 2200,
    emoji: "👷",
    isBoss: false,
  },
  {
    id: "employee2",
    name: "Empleado 2",
    role: "Trabajador",
    rate: 2200,
    emoji: "👷",
    isBoss: false,
  },
  {
    id: "employee3",
    name: "Empleado 3",
    role: "Trabajador",
    rate: 2200,
    emoji: "👷",
    isBoss: false,
  },
  {
    id: "employee4",
    name: "Empleado 4",
    role: "Trabajador",
    rate: 2200,
    emoji: "👷",
    isBoss: false,
  },
  {
    id: "employee5",
    name: "Empleado 5",
    role: "Trabajador",
    rate: 2200,
    emoji: "👷",
    isBoss: false,
  },
];

const DAY_NAMES = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// ==========================================
// Estado global
// ==========================================
let selectedDayIndex = 0;
let weekData = {};
let db = null;
let firebaseConnected = false;
let firebaseLoadComplete = false; // ← NUEVO: bloquea auto-save hasta cargar
let autoSaveInterval = null;
let expandedCards = {};
let lastSavedDataStr = null; // ← rastrea el último dato guardado
let saveInProgress = false;
let pendingCloudSync = null;

function queuePendingCloudSync(weekKey, data) {
  pendingCloudSync = {
    weekKey,
    data: JSON.parse(JSON.stringify(data)),
  };
}

async function flushPendingCloudSync() {
  if (!db || !firebaseConnected || !pendingCloudSync) return false;

  const snapshot = pendingCloudSync;
  const synced = await saveToCloud(snapshot.weekKey, snapshot.data);
  if (synced && pendingCloudSync === snapshot) {
    pendingCloudSync = null;
    return true;
  }

  return false;
}

// ==========================================
// Supabase
// ==========================================
const SUPABASE_CONFIG = {
  url: "https://onucfvatdhlwqilhnena.supabase.co",
  anonKey: "sb_publishable_uQeHIStd1T2IGyNr7gYsVw_niQ8aMOz",
};

async function initializeFirebase() {
  try {
    if (typeof window.supabase === "undefined") return;
    if (
      !SUPABASE_CONFIG.url ||
      SUPABASE_CONFIG.url.includes("TU-PROYECTO") ||
      !SUPABASE_CONFIG.anonKey ||
      SUPABASE_CONFIG.anonKey.includes("TU_SUPABASE")
    ) {
      firebaseLoadComplete = true;
      updateCloudStatus("disconnected", "Configura Supabase");
      return;
    }

    db = window.supabase.createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey
    );
    await testFirebaseConnection();
  } catch (e) {
    firebaseLoadComplete = true;
    updateCloudStatus("disconnected", "Error de configuración");
  }
}

async function testFirebaseConnection() {
  if (!db) {
    updateCloudStatus("disconnected", "Sin conexión");
    return;
  }
  try {
    updateCloudStatus("syncing", "Conectando...");

    const { error } = await db.from("config").select("key").limit(1);
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("404")) {
        firebaseConnected = false;
        firebaseLoadComplete = true;
        updateCloudStatus("disconnected", "Falta configurar tablas");
        showToast(
          "Supabase no tiene la tabla config. Ejecuta supabase-schema-anon.sql en SQL Editor.",
          "error"
        );
        return;
      }
      throw error;
    }

    firebaseConnected = true;
    updateCloudStatus("connected", "Nube conectada");
    await loadDataFromCloud();
  } catch (e) {
    firebaseConnected = false;
    firebaseLoadComplete = true; // permitir guardar aunque falle
    updateCloudStatus("disconnected", "Error de conexión");
  }
}

function updateCloudStatus(status, text) {
  const el = document.getElementById("cloudStatus");
  if (!el) return;
  el.className = "cloud-status " + status;
  el.innerHTML = '<span class="cloud-dot"></span> ' + text;
}

// ==========================================
// SISTEMA DE BACKUPS
// Cada guardado crea una copia con timestamp.
// Nunca sobreescribe un backup existente.
// Se conservan los últimos 50 backups.
// ==========================================
async function saveToCloud(key, data) {
  if (!db || !firebaseConnected) {
    queuePendingCloudSync(key, data);
    return false;
  }

  if (saveInProgress) {
    queuePendingCloudSync(key, data);
    return false;
  }

  saveInProgress = true;

  try {
    const dataStr = JSON.stringify(data);
    const nowIso = new Date().toISOString();

    // 1. Guardar datos principales siempre
    const { error: weekError } = await db.from("weeks").upsert(
      {
        week_key: key,
        data,
        updated_at: nowIso,
      },
      { onConflict: "week_key" }
    );
    if (weekError) throw weekError;

    // 2. Crear backup SOLO si los datos cambiaron desde el último guardado
    if (dataStr !== lastSavedDataStr) {
      lastSavedDataStr = dataStr;
      updateCloudStatus("syncing", "Creando backup...");

      const { error: backupError } = await db.from("backups").insert({
        week_key: key,
        data,
        saved_at: nowIso,
      });
      if (backupError) throw backupError;

      // 3. Limpiar backups viejos (conservar solo los últimos 50)
      cleanOldBackups(key);
    }

    updateCloudStatus("connected", "Nube sincronizada ✓");
    updateLastSaved();
    return true;
  } catch (e) {
    queuePendingCloudSync(key, data);
    const msg = String((e && e.message) || "").toLowerCase();
    if (msg.includes("401") || msg.includes("unauthorized")) {
      updateCloudStatus("disconnected", "Sin permisos de guardado");
      showToast(
        "Supabase devolvio 401. Ejecuta supabase-fix-401-anon.sql en SQL Editor.",
        "error"
      );
    } else {
      updateCloudStatus("disconnected", "Error al guardar");
    }
    return false;
  } finally {
    saveInProgress = false;
  }
}

async function cleanOldBackups(weekKey) {
  if (!db) return;
  try {
    const { data: rows, error } = await db
      .from("backups")
      .select("id")
      .eq("week_key", weekKey)
      .order("saved_at", { ascending: false });

    if (error || !rows || rows.length <= 50) return;

    const idsToDelete = rows.slice(50).map((r) => r.id);
    if (idsToDelete.length > 0) {
      await db.from("backups").delete().in("id", idsToDelete);
    }
  } catch (e) {
    /* ignorar errores de limpieza */
  }
}

async function loadFromCloud() {
  if (!db || !firebaseConnected) return null;
  const key = generateWeekKey();
  try {
    const { data: row, error } = await db
      .from("weeks")
      .select("data")
      .eq("week_key", key)
      .maybeSingle();

    if (error) throw error;
    if (row && row.data) return row.data;
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function loadDataFromCloud() {
  // Cargar tarifas primero
  await loadRatesFromCloud();

  const cloud = await loadFromCloud();
  if (cloud) {
    weekData = cloud;
    initWeekData();
  } else {
    weekData = {};
    initWeekData();
  }
  firebaseLoadComplete = true;
  lastSavedDataStr = JSON.stringify(weekData); // no hacer backup del estado inicial

  await flushPendingCloudSync();

  renderAll();
  updateLastSaved();
}

// ==========================================
// Panel de Backups: ver y restaurar
// ==========================================
async function showBackupsPanel() {
  if (!db || !firebaseConnected) {
    showToast("Sin conexión a la nube", "error");
    return;
  }

  const key = generateWeekKey();
  showToast("Cargando backups...", "info");

  try {
    const { data: docs, error } = await db
      .from("backups")
      .select("id, data, saved_at")
      .eq("week_key", key)
      .order("saved_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    let html = "<h2>🗄️ Backups de esta semana</h2>";
    html +=
      '<p style="color:#94a3b8;font-size:0.85rem;margin-bottom:15px;">Se conservan los últimos 50 guardados. Puedes restaurar cualquiera.</p>';

    if (docs.length === 0) {
      html +=
        '<p style="color:#f87171;">No hay backups disponibles para esta semana.</p>';
    } else {
      html += '<div style="max-height:400px;overflow-y:auto;">';
      docs.forEach((doc, i) => {
        const parsed = doc.data || {};
        // Contar entradas con datos
        let filledEntries = 0;
        EMPLOYEES.forEach((emp) => {
          if (parsed[emp.id]) {
            for (let day = 0; day < 7; day++) {
              const entry = parsed[emp.id][day];
              if (entry && (entry.entry || entry.exit)) filledEntries++;
            }
          }
        });

        html +=
          '<div style="background:#0f172a;border-radius:8px;padding:12px;margin-bottom:8px;border:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">';
        html += '<div>';
        html +=
          '<div style="color:#f1f5f9;font-weight:600;font-size:0.9rem;">' +
          (i === 0 ? "🟢 Más reciente" : "📁 Backup #" + (i + 1)) +
          "</div>";
        html +=
          '<div style="color:#94a3b8;font-size:0.8rem;margin-top:3px;">' +
          new Date(doc.saved_at).toLocaleString("es-CR", {
            timeZone: "America/Costa_Rica",
          }) +
          "</div>";
        html +=
          '<div style="color:#60a5fa;font-size:0.75rem;margin-top:2px;">' +
          filledEntries +
          " registros con datos</div>";
        html += "</div>";
        html +=
          '<button onclick="restoreBackup(\'' +
          doc.id +
          '\')" style="background:linear-gradient(135deg,#059669,#10b981);color:white;border:none;padding:8px 14px;border-radius:8px;font-size:0.8rem;font-weight:600;cursor:pointer;">Restaurar</button>';
        html += "</div>";
      });
      html += "</div>";
    }

    showReportModal(html);
  } catch (e) {
    showToast("Error al cargar backups: " + e.message, "error");
  }
}

async function restoreBackup(backupDocId) {
  if (
    !confirm(
      "⚠️ ¿Restaurar este backup? Los datos actuales serán reemplazados."
    )
  )
    return;
  try {
    const backupId = Number(backupDocId);
    const { data: row, error } = await db
      .from("backups")
      .select("data")
      .eq("id", backupId)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      showToast("Backup no encontrado", "error");
      return;
    }
    weekData = row.data || {};
    initWeekData();
    const key = generateWeekKey();
    await saveToCloud(key, weekData);
    renderAll();
    document.querySelector(".modal-overlay").remove();
    showToast("✅ Backup restaurado exitosamente", "success");
  } catch (e) {
    showToast("Error al restaurar: " + e.message, "error");
  }
}

// ==========================================
// Panel de Tarifas
// ==========================================
function showRatesPanel() {
  let html = "<h2>💰 Tarifas por Hora</h2>";
  html +=
    '<p style="color:#94a3b8;font-size:0.85rem;margin-bottom:18px;">Modifica el pago por hora de cada empleado en colones (₡).</p>';

  html += '<div id="ratesForm">';
  EMPLOYEES.forEach((emp) => {
    html +=
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;background:#0f172a;padding:12px;border-radius:10px;border:1px solid ' +
      (emp.isBoss ? "#fbbf2433" : "#3b82f633") +
      ';">';
    html +=
      '<div style="font-size:1.5rem;width:40px;text-align:center;">' +
      emp.emoji +
      "</div>";
    html += '<div style="flex:1;">';
    html +=
      '<div style="color:#f1f5f9;font-weight:600;font-size:0.9rem;">' +
      emp.name +
      "</div>";
    html +=
      '<div style="color:#94a3b8;font-size:0.75rem;">' +
      emp.role +
      "</div>";
    html += "</div>";
    html +=
      '<div style="display:flex;align-items:center;gap:6px;background:#1e293b;padding:6px 10px;border-radius:8px;border:2px solid ' +
      (emp.isBoss ? "#fbbf24" : "#3b82f6") +
      ';">';
    html += '<span style="color:#94a3b8;font-size:0.9rem;">₡</span>';
    html +=
      '<input type="number" id="rate_' +
      emp.id +
      '" value="' +
      emp.rate +
      '" min="0" step="100" ' +
      'style="background:transparent;border:none;color:' +
      (emp.isBoss ? "#fbbf24" : "#60a5fa") +
      ';font-size:1rem;font-weight:700;width:80px;outline:none;" />';
    html += '<span style="color:#94a3b8;font-size:0.75rem;">/hr</span>';
    html += "</div>";
    html += "</div>";
  });
  html += "</div>";

  html +=
    '<div class="modal-actions" style="margin-top:15px;display:flex;gap:10px;justify-content:flex-end;">';
  html +=
    '<button onclick="this.closest(\'.modal-overlay\').remove()" style="padding:10px 20px;border:none;border-radius:8px;background:#334155;color:#94a3b8;font-weight:600;cursor:pointer;">Cancelar</button>';
  html +=
    '<button onclick="saveRates()" style="padding:10px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,#059669,#10b981);color:white;font-weight:600;cursor:pointer;">💾 Guardar Tarifas</button>';
  html += "</div>";

  showReportModal(html);
}

function saveRates() {
  let changed = false;
  EMPLOYEES.forEach((emp) => {
    const input = document.getElementById("rate_" + emp.id);
    if (input) {
      const newRate = parseInt(input.value, 10);
      if (!isNaN(newRate) && newRate >= 0 && newRate !== emp.rate) {
        emp.rate = newRate;
        changed = true;
      }
    }
  });

  if (changed) {
    // Guardar tarifas en la nube
    if (db && firebaseConnected) {
      const rates = {};
      EMPLOYEES.forEach((emp) => {
        rates[emp.id] = emp.rate;
      });
      db.from("config")
        .upsert({
          key: "rates",
          value: rates,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) {
            showToast("No se pudo guardar tarifas en la nube", "error");
          }
        });
    }
    renderAll();
    document.querySelector(".modal-overlay").remove();
    showToast("✅ Tarifas actualizadas", "success");
  } else {
    document.querySelector(".modal-overlay").remove();
    showToast("Sin cambios en tarifas", "info");
  }
}

async function loadRatesFromCloud() {
  if (!db || !firebaseConnected) return;
  try {
    const { data: row, error } = await db
      .from("config")
      .select("value")
      .eq("key", "rates")
      .maybeSingle();

    if (error) throw error;
    if (row && row.value) {
      const rates = row.value;
      EMPLOYEES.forEach((emp) => {
        if (rates[emp.id] !== undefined) {
          emp.rate = rates[emp.id];
        }
      });
    }
  } catch (e) {
    /* ignore */
  }
}

// ==========================================
// Funciones de fecha y semana
// ==========================================
function getNowCostaRica() {
  const now = new Date();
  const crString = now.toLocaleString("en-US", {
    timeZone: "America/Costa_Rica",
  });
  return new Date(crString);
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function generateWeekKey() {
  const monday = getMondayOfWeek(getNowCostaRica());
  return (
    "week_" +
    monday.getFullYear() +
    "-" +
    String(monday.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(monday.getDate()).padStart(2, "0")
  );
}

function formatDate(date) {
  return date.getDate() + " de " + MONTH_NAMES[date.getMonth()];
}

function getDateForDayIndex(dayIndex) {
  const monday = getMondayOfWeek(getNowCostaRica());
  const d = new Date(monday);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

function getTodayDayIndex() {
  const today = getNowCostaRica();
  const day = today.getDay();
  return day === 0 ? 6 : day - 1;
}

function calculateHoursBetween(entry, exit) {
  if (!entry || !exit) return 0;
  const [eh, em] = entry.split(":").map(Number);
  const [xh, xm] = exit.split(":").map(Number);
  let entryMin = eh * 60 + em;
  let exitMin = xh * 60 + xm;
  if (exitMin <= entryMin) exitMin += 24 * 60;
  return (exitMin - entryMin) / 60;
}

// ==========================================
// Datos
// ==========================================
function initWeekData() {
  EMPLOYEES.forEach((emp) => {
    if (!weekData[emp.id]) weekData[emp.id] = {};
    for (let d = 0; d < 7; d++) {
      if (!weekData[emp.id][d]) {
        weekData[emp.id][d] = { entry: "", exit: "" };
      }
    }
  });
}

function collectCurrentDayFromDOM() {
  EMPLOYEES.forEach((emp) => {
    const entryEl = document.getElementById("entry_" + emp.id);
    const exitEl = document.getElementById("exit_" + emp.id);
    if (entryEl && exitEl) {
      if (!weekData[emp.id]) weekData[emp.id] = {};
      weekData[emp.id][selectedDayIndex] = {
        entry: entryEl.value || "",
        exit: exitEl.value || "",
      };
    }
  });
}

function getWeekTotals(empId) {
  let totalHours = 0;
  for (let d = 0; d < 7; d++) {
    const dayData = weekData[empId] && weekData[empId][d];
    if (dayData) {
      totalHours += calculateHoursBetween(dayData.entry, dayData.exit);
    }
  }
  return totalHours;
}

function getDayHours(empId, dayIndex) {
  const dayData = weekData[empId] && weekData[empId][dayIndex];
  if (!dayData) return 0;
  return calculateHoursBetween(dayData.entry, dayData.exit);
}

function dayHasData(dayIndex) {
  return EMPLOYEES.some((emp) => {
    const d = weekData[emp.id] && weekData[emp.id][dayIndex];
    return d && (d.entry || d.exit);
  });
}

// ==========================================
// Guardado
// ==========================================
function updateLastSaved() {
  const el = document.getElementById("lastSaved");
  if (!el) return;
  const now = getNowCostaRica();
  el.textContent =
    "Guardado: " +
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0");
}

async function autoSave() {
  // ← PROTECCIÓN: no guardar hasta que la nube haya cargado los datos
  if (!firebaseLoadComplete) return;

  collectCurrentDayFromDOM();
  const key = generateWeekKey();

  if (firebaseConnected) {
    await saveToCloud(key, weekData);
    await flushPendingCloudSync();
  }
}

async function manualSave() {
  collectCurrentDayFromDOM();
  const key = generateWeekKey();

  if (firebaseConnected) {
    const ok = await saveToCloud(key, weekData);
    if (ok) {
      showToast("💾 Datos guardados y backup creado", "success");
    } else {
      showToast("No se pudo guardar en nube. Reintentando...", "error");
    }
  } else {
    showToast("Sin conexión a la nube. No se guardó.", "error");
  }
}

// ==========================================
// UI: Navegador de Días
// ==========================================
function navigateDay(direction) {
  collectCurrentDayFromDOM();
  selectedDayIndex += direction;
  if (selectedDayIndex < 0) selectedDayIndex = 6;
  if (selectedDayIndex > 6) selectedDayIndex = 0;
  renderAll();
}

function goToDay(dayIndex) {
  collectCurrentDayFromDOM();
  selectedDayIndex = dayIndex;
  renderAll();
}

function updateDayNavigator() {
  const dayDate = getDateForDayIndex(selectedDayIndex);
  document.getElementById("currentDayName").textContent =
    DAY_NAMES[selectedDayIndex];
  document.getElementById("currentDate").textContent = formatDate(dayDate);

  const monday = getMondayOfWeek(getNowCostaRica());
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  document.getElementById("weekLabel").textContent =
    "Semana: " + formatDate(monday) + " - " + formatDate(sunday);
}

function renderWeekDots() {
  const container = document.getElementById("weekDots");
  const todayIdx = getTodayDayIndex();
  let html = "";
  for (let d = 0; d < 7; d++) {
    let classes = "week-dot";
    if (d === selectedDayIndex) classes += " active";
    if (d === todayIdx) classes += " today";
    if (dayHasData(d)) classes += " has-data";
    html +=
      '<div class="' +
      classes +
      '" onclick="goToDay(' +
      d +
      ')">' +
      DAY_SHORT[d] +
      "</div>";
  }
  container.innerHTML = html;
}

// ==========================================
// UI: Tarjetas de Empleados
// ==========================================
function renderEmployeeCards() {
  const container = document.getElementById("employeesContainer");
  let html = "";

  EMPLOYEES.forEach((emp) => {
    const dayData = (weekData[emp.id] &&
      weekData[emp.id][selectedDayIndex]) || { entry: "", exit: "" };
    const dayHrs = getDayHours(emp.id, selectedDayIndex);
    const weekHrs = getWeekTotals(emp.id);
    const weekSalary = weekHrs * emp.rate;
    const isExpanded = expandedCards[emp.id] !== false;

    html += '<div class="employee-card' + (emp.isBoss ? " boss" : "") + '">';

    html +=
      '<div class="employee-header" onclick="toggleCard(\'' + emp.id + "')\">";
    html += '<div class="employee-info">';
    html += '<div class="employee-avatar">' + emp.emoji + "</div>";
    html += '<div class="employee-details">';
    html += "<h3>" + emp.name + "</h3>";
    html +=
      '<span class="employee-role">' +
      emp.role +
      " · ₡" +
      emp.rate.toLocaleString() +
      "/hr</span>";
    html += "</div></div>";
    html += '<div class="employee-header-right">';
    html +=
      '<div class="employee-day-total">' + dayHrs.toFixed(1) + " hrs hoy</div>";
    html +=
      '<div class="employee-week-total">' +
      weekHrs.toFixed(1) +
      " hrs semana</div>";
    html += "</div>";
    html += "</div>";

    html +=
      '<div class="employee-content' +
      (isExpanded ? " expanded" : "") +
      '" id="content_' +
      emp.id +
      '">';
    html += '<div class="employee-body">';
    html += '<div class="time-row">';
    html += '<div class="time-group">';
    html += "<label>🕐 Entrada</label>";
    html +=
      '<input type="time" class="time-input" id="entry_' +
      emp.id +
      '" value="' +
      dayData.entry +
      '" onchange="onTimeChange(\'' +
      emp.id +
      "')\">";
    html += "</div>";
    html += '<div class="time-group">';
    html += "<label>🕐 Salida</label>";
    html +=
      '<input type="time" class="time-input" id="exit_' +
      emp.id +
      '" value="' +
      dayData.exit +
      '" onchange="onTimeChange(\'' +
      emp.id +
      "')\">";
    html += "</div>";
    html += "</div>";
    html +=
      '<div class="day-hours-display" id="dayHours_' +
      emp.id +
      '">' +
      dayHrs.toFixed(1) +
      " horas</div>";
    html += "</div>";

    html += '<div class="employee-mini-summary">';
    html +=
      '<div class="mini-stat"><div class="mini-stat-value">' +
      weekHrs.toFixed(1) +
      '</div><div class="mini-stat-label">Hrs/Sem</div></div>';
    html +=
      '<div class="mini-stat"><div class="mini-stat-value">₡' +
      weekSalary.toLocaleString() +
      '</div><div class="mini-stat-label">Salario</div></div>';
    html += "</div>";

    html += "</div>";
    html += "</div>";
  });

  container.innerHTML = html;
}

function toggleCard(empId) {
  expandedCards[empId] = !expandedCards[empId];
  const el = document.getElementById("content_" + empId);
  if (el) {
    el.classList.toggle("expanded");
  }
}

function onTimeChange(empId) {
  const entryEl = document.getElementById("entry_" + empId);
  const exitEl = document.getElementById("exit_" + empId);
  if (!entryEl || !exitEl) return;

  if (!weekData[empId]) weekData[empId] = {};
  weekData[empId][selectedDayIndex] = {
    entry: entryEl.value || "",
    exit: exitEl.value || "",
  };

  const hrs = calculateHoursBetween(entryEl.value, exitEl.value);
  const hrsEl = document.getElementById("dayHours_" + empId);
  if (hrsEl) hrsEl.textContent = hrs.toFixed(1) + " horas";

  updateWeeklySummary();
  renderWeekDots();

  const key = generateWeekKey();

  if (firebaseConnected && firebaseLoadComplete) {
    saveToCloud(key, weekData);
  }
}

// ==========================================
// UI: Resumen Semanal
// ==========================================
function updateWeeklySummary() {
  const container = document.getElementById("summaryContent");
  if (!container) return;
  let totalGlobal = 0;
  let totalHoursGlobal = 0;

  let html = '<table class="summary-table">';
  html += "<thead><tr>";
  html += "<th>Empleado</th>";
  html += "<th>Tarifa/hr</th>";
  html += "<th>Horas</th>";
  html += "<th>Salario</th>";
  html += "</tr></thead>";
  html += "<tbody>";

  EMPLOYEES.forEach((emp) => {
    const weekHrs = getWeekTotals(emp.id);
    const salary = weekHrs * emp.rate;
    totalGlobal += salary;
    totalHoursGlobal += weekHrs;

    html += "<tr" + (emp.isBoss ? ' class="row-boss"' : "") + ">";
    html +=
      '<td><span class="tbl-avatar">' +
      emp.emoji +
      "</span>" +
      emp.name +
      "</td>";
    html += "<td>₡" + emp.rate.toLocaleString() + "</td>";
    html += "<td>" + weekHrs.toFixed(1) + "</td>";
    html += "<td>₡" + salary.toLocaleString() + "</td>";
    html += "</tr>";
  });

  html += "</tbody>";
  html += "<tfoot><tr>";
  html += '<td colspan="3">💰 Total Planilla</td>';
  html += "<td>₡" + totalGlobal.toLocaleString() + "</td>";
  html += "</tr></tfoot>";
  html += "</table>";

  container.innerHTML = html;
}

// ==========================================
// Renderizado principal
// ==========================================
function renderAll() {
  updateDayNavigator();
  renderWeekDots();
  renderEmployeeCards();
  updateWeeklySummary();
}

// ==========================================
// Reporte Semanal - PDF + Compartir
// ==========================================
function generateWeeklyReport() {
  collectCurrentDayFromDOM();

  var { jsPDF } = window.jspdf;
  var doc = new jsPDF('p', 'pt', 'a4');

  var FONT_REGULAR = "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alMDaf4DaH0DZxFCBWb+A2X+A2T+A2P+A2L+A2E6A2D6A14MA13+A1v+A1r+A1lYCgVZ+gNYCgNXFhkFVzIDVv4DVVQVBVVCA1QVA1MBEAVTGANSFANRShMFUf4DUAsDT/4DTk0QBU7+A00QA0z+A0tKEwVL/gNKSRAFShMDSR0NBUkQA0gNA0f+A0aWA0WWA0T+A0MCLQVD+gNCuwNBSwNA/gM//gM+PRIFPhQDPTwPBT0SAzw7DQU8QP8PAzsNAzr+Azn+Azg3FAU4+gM3NhAFNxQDNjULBTYQAzULAzQeAzMNAzIxCwUy/gMxCwMwLwsFMA0DLwsDLi0JBS4QAy0JAywyAysqJQUrZAMqKRIFKiUDKRIDKCclBShBAyclAyYlCwUmDwMlCwMk/gMj/gMiDwMhARAFIRIDIGQDH/oDHh0NBR5kAx0NAxwRQgUc/gMb+gMaQgMZEUIFGf4DGGQDFxYZBRf+AxYBEAUWGQMV/gMU/gMT/gMSEUIFEv4DEQItBRFCAxB9Aw9kAw7+Aw0MFgUN/gMMARAFDBYDC/4DChADCf4DCAItBQj+AwcUAwZkAwQBEAUE/gNAFQMCLQUD/gMCARAFAi0DARADAP4DAbgBZIWNASsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKwArKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrHQE1ALgAywDLAMEAqgCcAaYAuABmAAAAcQDLAKACsgCFAHUAuADDAcsBiQItAMsApgDwANMAqgCHAMsDqgQAAUoAMwDLAAAA2QUCAPQBVAC0AJwBOQEUATkHBgQABE4EtARSBLgE5wTN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";
  var FONT_BOLD    = "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CgMFQAQE+gMDZAMCAREFAv4DAQANBQERAwANAwG4AWSFjQErKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrACsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKx0AAWYBMwFmALwA6QAAAT0AogD6Ax8AAgACAGYBZgACAAIArAFUAOwAvABiAWYBgQSFAVQBZgFtBKQAAgFmAH8EzQAAAAIBMwBiAHEAAAAlBKQBvAC6AOUAZgGBAY0FSAVaAWYBbQAAAAAAAgACAPYFwwHwBTkCOQBYBG0EPQSyBIEEsgFmAXUEZgSBALAEZgQ5AtEEnAR7BM8EewBYATMBZgFMAWYBTAACAKwAmgFKASMAmgKaAUQBGQFEAs0AwQAAAWYBPwGaATsFywXLANUA1QFQAKwArAB3AgoBxwHyAS8BWAGyASMA9gD2AR8BLwE1AjUB7gHnATMAmADRA1gFCgCaAI8BEgCYALwAzQDlAOUA8gBzBAABZgCPBdUCKwXVAMMA4QDXAOUAAABqAQIAAAAdAy0F1QXVBfAAqABqAOwA4QECBdUGFAchBGYC+ADsAYMCpgL4ASMBAgECARIBHwMfAF4DzQRgBMcEiQDsAbwAugECAzMDHwNCAzMDXAESAR8F1QGaAJoA4QZmAXkEYARgBGAEewAAAOwCwwK4As0AvgDdANUAAABqAlwCewKaAN0BrgG6ARIAAACF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";
  doc.addFileToVFS('DejaVuSans.ttf', FONT_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', FONT_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');

  var W = doc.internal.pageSize.getWidth();  // 595pt
  var H = doc.internal.pageSize.getHeight(); // 842pt
  var m = 40;
  var cW = W - m * 2; // 515pt ancho util
  var y = m;

  var monday = getMondayOfWeek(getNowCostaRica());
  var sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  var weekLabel = formatDate(monday) + ' - ' + formatDate(sunday);

  // Formato de montos: separador de miles con coma, sin puntos
  function fmt(n) {
    var rounded = Math.round(n);
    var str = '';
    var s = rounded.toString();
    var count = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      if (count > 0 && count % 3 === 0) str = ',' + str;
      str = s[i] + str;
      count++;
    }
    return '\u20A1' + str;
  }

  function sf(style, size) {
    doc.setFont('DejaVu', style);
    doc.setFontSize(size);
  }

  function newPage(need) {
    if (y + need > H - m) { doc.addPage(); y = m; }
  }

  // --- Encabezado ---
  doc.setFillColor(30, 64, 175);
  doc.roundedRect(m, y, cW, 52, 6, 6, 'F');
  doc.setTextColor(255, 255, 255);
  sf('bold', 15);
  doc.text('Reporte de Planilla Semanal', m + 14, y + 24);
  sf('normal', 10);
  doc.text('Semana: ' + weekLabel, m + 14, y + 42);
  y += 66;

  var grandTotal = 0;
  var grandHours = 0;

  EMPLOYEES.forEach(function(emp) {
    var wHrs = getWeekTotals(emp.id);
    var sal  = wHrs * emp.rate;
    if (wHrs === 0) return;
    grandTotal += sal;
    grandHours += wHrs;

    var rows = [];
    for (var d = 0; d < 7; d++) {
      var dd  = weekData[emp.id] && weekData[emp.id][d];
      var hrs = getDayHours(emp.id, d);
      if (hrs > 0 || (dd && (dd.entry || dd.exit))) {
        rows.push([
          DAY_NAMES[d],
          dd ? (dd.entry || '--') : '--',
          dd ? (dd.exit  || '--') : '--',
          hrs.toFixed(1) + ' hrs'
        ]);
      }
    }

    newPage(26 + 20 + rows.length * 20 + 26);

    // Cabecera empleado
    var rgb = emp.isBoss ? [217, 119, 6] : [30, 64, 175];
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(m, y, cW, 26, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    sf('bold', 11);
    doc.text(emp.name, m + 10, y + 17);
    sf('normal', 10);
    // Tarifa: posicion fija desde la derecha usando m+cW como referencia
    var rateStr = fmt(emp.rate) + '/hr';
    doc.text(rateStr, m + cW - 10, y + 17, { align: 'right' });
    y += 26;

    // Encabezado tabla - columnas fijas
    var c1 = m;           // Dia       - 120pt
    var c2 = m + 130;     // Entrada   - 100pt
    var c3 = m + 260;     // Salida    - 100pt
    var c4 = m + 390;     // Horas     - resto

    doc.setFillColor(241, 245, 249);
    doc.rect(m, y, cW, 20, 'F');
    doc.setTextColor(100, 116, 139);
    sf('bold', 8);
    doc.text('DIA',     c1 + 6,  y + 13);
    doc.text('ENTRADA', c2 + 50, y + 13, { align: 'center' });
    doc.text('SALIDA',  c3 + 50, y + 13, { align: 'center' });
    doc.text('HORAS',   m + cW - 6, y + 13, { align: 'right' });
    y += 20;

    rows.forEach(function(r, i) {
      doc.setFillColor(i % 2 === 0 ? 255 : 248, i % 2 === 0 ? 255 : 250, 255);
      doc.rect(m, y, cW, 20, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(m, y + 20, m + cW, y + 20);
      doc.setTextColor(71, 85, 105);
      sf('normal', 10);
      doc.text(r[0], c1 + 6,  y + 13);
      doc.text(r[1], c2 + 50, y + 13, { align: 'center' });
      doc.text(r[2], c3 + 50, y + 13, { align: 'center' });
      doc.setTextColor(30, 64, 175);
      sf('bold', 10);
      doc.text(r[3], m + cW - 6, y + 13, { align: 'right' });
      y += 20;
    });

    // Pie empleado - salario alineado a la izquierda desde posicion calculada
    doc.setFillColor(248, 250, 252);
    doc.rect(m, y, cW, 24, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(m, y, m + cW, y);
    doc.setTextColor(100, 116, 139);
    sf('normal', 10);
    doc.text('Total: ' + wHrs.toFixed(1) + ' hrs', m + 10, y + 15);
    doc.setTextColor(5, 150, 105);
    sf('bold', 12);
    // Escribir salario desde posicion fija - SIN align right para evitar corte
    var salStr = fmt(sal);
    doc.text(salStr, m + cW - 10, y + 16, { align: 'right' });
    y += 32;
  });

  // Total general
  newPage(40);
  doc.setFillColor(30, 64, 175);
  doc.roundedRect(m, y, cW, 38, 6, 6, 'F');
  doc.setTextColor(255, 255, 255);
  sf('bold', 12);
  doc.text('Total Planilla  -  ' + grandHours.toFixed(1) + ' hrs', m + 14, y + 24);
  sf('bold', 14);
  doc.text(fmt(grandTotal), m + cW - 14, y + 24, { align: 'right' });

  // Descarga directa
  var filename = 'planilla_' + weekLabel.replace(/\s/g, '_') + '.pdf';
  var blob = doc.output('blob');
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('PDF descargado', 'success');
}


function showReportModal(html) {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.remove();
  };

  const content = document.createElement("div");
  content.className = "modal-content";
  content.innerHTML =
    html +
    (html.includes("modal-actions")
      ? ""
      : '<div class="modal-actions"><button class="btn-save" onclick="this.closest(\'.modal-overlay\').remove()">Cerrar</button></div>');
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

// ==========================================
// Limpiar semana
// ==========================================
function clearAllData() {
  if (!confirm("⚠️ ¿Limpiar toda la semana? Esto eliminará TODOS los datos."))
    return;
  if (
    !confirm(
      "🚨 SEGUNDA CONFIRMACIÓN: ¿Está SEGURO? Esta acción NO se puede deshacer."
    )
  )
    return;
  weekData = {};
  initWeekData();
  const key = generateWeekKey();
  if (firebaseConnected) {
    saveToCloud(key, weekData);
  }
  renderAll();
  showToast("Semana limpiada", "info");
}

// ==========================================
// Toast
// ==========================================
function showToast(message, type) {
  const existing = document.querySelectorAll(".toast");
  existing.forEach((t) => t.remove());

  const toast = document.createElement("div");
  toast.className = "toast " + (type || "info");
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// ==========================================
// Inicialización
// ==========================================
async function init() {
  selectedDayIndex = getTodayDayIndex();

  EMPLOYEES.forEach((emp) => {
    expandedCards[emp.id] = true;
  });

  weekData = {};
  initWeekData();
  renderAll();

  // Conectar base de datos en la nube, cargar tarifas y datos
  await initializeFirebase();

  // Auto-guardado cada 5 segundos
  // PROTEGIDO: solo guarda si firebaseLoadComplete === true
  autoSaveInterval = setInterval(autoSave, 5000);

  window.addEventListener("online", async () => {
    await flushPendingCloudSync();
  });

  window.addEventListener("beforeunload", () => {
    if (!firebaseLoadComplete) return; // no guardar si no cargó
    collectCurrentDayFromDOM();
    if (firebaseConnected) {
      const key = generateWeekKey();
      saveToCloud(key, weekData);
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);