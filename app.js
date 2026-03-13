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

// ==========================================
// Firebase
// ==========================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCP6yPEuFP4p_mNVjjd25BvFjdJHcy-xs4",
  authDomain: "programa-horas-trabajo.firebaseapp.com",
  databaseURL: "https://programa-horas-trabajo-default-rtdb.firebaseio.com",
  projectId: "programa-horas-trabajo",
  storageBucket: "programa-horas-trabajo.firebasestorage.app",
  messagingSenderId: "206495516389",
  appId: "1:206495516389:web:2dc25103924238c769f60c",
  measurementId: "G-5T8EFCXQSC",
};

function initializeFirebase() {
  try {
    if (typeof firebase === "undefined") return;
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    testFirebaseConnection();
  } catch (e) {
    /* silently fail */
  }
}

async function testFirebaseConnection() {
  if (!db) {
    updateCloudStatus("disconnected", "Sin conexión");
    return;
  }
  try {
    updateCloudStatus("syncing", "Conectando...");
    await db.collection("_test").doc("ping").set({ t: Date.now() });
    firebaseConnected = true;
    updateCloudStatus("connected", "Nube conectada");
    await loadDataFromFirebase();
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
  if (!db || !firebaseConnected) return;
  try {
    const dataStr = JSON.stringify(data);
    const now = Date.now();

    // 1. Guardar datos principales siempre
    await db.collection("weeks").doc(key).set({
      data: dataStr,
      updatedAt: now,
    });

    // 2. Crear backup SOLO si los datos cambiaron desde el último guardado
    if (dataStr !== lastSavedDataStr) {
      lastSavedDataStr = dataStr;
      updateCloudStatus("syncing", "Creando backup...");

      const backupKey = key + "_backup_" + now;
      await db.collection("backups").doc(backupKey).set({
        data: dataStr,
        weekKey: key,
        savedAt: now,
        savedAtReadable: new Date(now).toLocaleString("es-CR", {
          timeZone: "America/Costa_Rica",
        }),
      });

      // 3. Limpiar backups viejos (conservar solo los últimos 50)
      cleanOldBackups(key);
    }

    updateCloudStatus("connected", "Nube sincronizada ✓");
    updateLastSaved();
  } catch (e) {
    updateCloudStatus("disconnected", "Error al guardar");
  }
}

async function cleanOldBackups(weekKey) {
  if (!db) return;
  try {
    const snapshot = await db
      .collection("backups")
      .where("weekKey", "==", weekKey)
      .orderBy("savedAt", "desc")
      .get();

    const docs = snapshot.docs;
    if (docs.length > 50) {
      // Eliminar los más viejos (todo después del índice 50)
      const toDelete = docs.slice(50);
      const batch = db.batch();
      toDelete.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  } catch (e) {
    /* ignorar errores de limpieza */
  }
}

async function loadFromCloud() {
  if (!db || !firebaseConnected) return null;
  const key = generateWeekKey();
  try {
    const doc = await db.collection("weeks").doc(key).get();
    if (doc.exists) {
      return JSON.parse(doc.data().data);
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function loadDataFromFirebase() {
  // Cargar tarifas primero
  await loadRatesFromFirebase();

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
  renderAll();
  updateLastSaved();
}

// ==========================================
// Panel de Backups: ver y restaurar
// ==========================================
async function showBackupsPanel() {
  if (!db || !firebaseConnected) {
    showToast("Sin conexión a Firebase", "error");
    return;
  }

  const key = generateWeekKey();
  showToast("Cargando backups...", "info");

  try {
    const snapshot = await db
      .collection("backups")
      .where("weekKey", "==", key)
      .orderBy("savedAt", "desc")
      .limit(50)
      .get();

    const docs = snapshot.docs;

    let html = "<h2>🗄️ Backups de esta semana</h2>";
    html +=
      '<p style="color:#94a3b8;font-size:0.85rem;margin-bottom:15px;">Se conservan los últimos 50 guardados. Puedes restaurar cualquiera.</p>';

    if (docs.length === 0) {
      html +=
        '<p style="color:#f87171;">No hay backups disponibles para esta semana.</p>';
    } else {
      html += '<div style="max-height:400px;overflow-y:auto;">';
      docs.forEach((doc, i) => {
        const d = doc.data();
        const parsed = JSON.parse(d.data);
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
          d.savedAtReadable +
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
    const doc = await db.collection("backups").doc(backupDocId).get();
    if (!doc.exists) {
      showToast("Backup no encontrado", "error");
      return;
    }
    weekData = JSON.parse(doc.data().data);
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
    // Guardar tarifas en Firebase
    if (db && firebaseConnected) {
      const rates = {};
      EMPLOYEES.forEach((emp) => {
        rates[emp.id] = emp.rate;
      });
      db.collection("config").doc("rates").set({ rates, updatedAt: Date.now() });
    }
    renderAll();
    document.querySelector(".modal-overlay").remove();
    showToast("✅ Tarifas actualizadas", "success");
  } else {
    document.querySelector(".modal-overlay").remove();
    showToast("Sin cambios en tarifas", "info");
  }
}

async function loadRatesFromFirebase() {
  if (!db || !firebaseConnected) return;
  try {
    const doc = await db.collection("config").doc("rates").get();
    if (doc.exists) {
      const rates = doc.data().rates;
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

function autoSave() {
  // ← PROTECCIÓN: no guardar hasta que Firebase haya cargado los datos
  if (!firebaseLoadComplete) return;

  collectCurrentDayFromDOM();
  const key = generateWeekKey();
  if (firebaseConnected) {
    saveToCloud(key, weekData);
  }
}

function manualSave() {
  collectCurrentDayFromDOM();
  const key = generateWeekKey();
  if (firebaseConnected) {
    saveToCloud(key, weekData);
    showToast("💾 Datos guardados y backup creado", "success");
  } else {
    showToast("Sin conexión a Firebase. Intente de nuevo.", "error");
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

  if (firebaseConnected && firebaseLoadComplete) {
    const key = generateWeekKey();
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
  html += '<td colspan="2">💰 Total Planilla</td>';
  html += "<td>" + totalHoursGlobal.toFixed(1) + "</td>";
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

  function fmt(num) {
    return '\u20A1' + Math.round(num).toLocaleString('es-CR');
  }

  const monday   = getMondayOfWeek(getNowCostaRica());
  const sunday   = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const weekLabel = formatDate(monday) + ' - ' + formatDate(sunday);

  let grandTotal = 0, grandHours = 0, cardsHTML = '';

  EMPLOYEES.forEach(function(emp) {
    const weekHrs = getWeekTotals(emp.id);
    const salary  = weekHrs * emp.rate;
    if (weekHrs === 0) return;
    grandTotal += salary;
    grandHours += weekHrs;

    let rows = '';
    for (let d = 0; d < 7; d++) {
      const dd   = weekData[emp.id] && weekData[emp.id][d];
      const hrs  = getDayHours(emp.id, d);
      if (hrs > 0 || (dd && (dd.entry || dd.exit))) {
        rows += '<tr>'
          + '<td class="dc">' + DAY_NAMES[d] + '</td>'
          + '<td class="tc">' + (dd ? dd.entry || '--' : '--') + '</td>'
          + '<td class="tc">' + (dd ? dd.exit  || '--' : '--') + '</td>'
          + '<td class="hr">' + hrs.toFixed(1) + ' hrs</td>'
          + '</tr>';
      }
    }

    const hbg = emp.isBoss ? '#d97706' : '#1e40af';
    cardsHTML += ''
      + '<div class="card">'
      +   '<div class="emp-hdr" style="background:' + hbg + '">'
      +     '<span>' + emp.name + '</span>'
      +     '<span>' + fmt(emp.rate) + '/hr</span>'
      +   '</div>'
      +   '<table><thead><tr>'
      +     '<th class="tl">Dia</th><th class="tc">Entrada</th><th class="tc">Salida</th><th class="tr">Horas</th>'
      +   '</tr></thead><tbody>' + rows + '</tbody></table>'
      +   '<div class="emp-ftr">'
      +     '<span>Total: <b>' + weekHrs.toFixed(1) + ' hrs</b></span>'
      +     '<span class="sal">' + fmt(salary) + '</span>'
      +   '</div>'
      + '</div>';
  });

  const now = getNowCostaRica().toLocaleString('es-CR');
  const html = '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="UTF-8"/>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
    + '<title>Planilla ' + weekLabel + '</title>'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Arial,sans-serif;background:#fff;color:#1e293b;padding:20px;font-size:12px}'
    + '.hdr{background:#1e40af;color:#fff;border-radius:8px;padding:12px 16px;margin-bottom:16px}'
    + '.hdr h1{font-size:16px;font-weight:700;margin-bottom:2px}'
    + '.hdr p{font-size:11px;opacity:.85}'
    + '.card{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:12px;page-break-inside:avoid}'
    + '.emp-hdr{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;color:#fff;font-weight:700;font-size:12px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th{background:#f1f5f9;padding:5px 8px;font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0}'
    + 'th.tl{text-align:left}th.tc{text-align:center}th.tr{text-align:right}'
    + 'td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px}'
    + 'td.dc{color:#475569}td.tc{text-align:center;color:#334155}td.hr{text-align:right;color:#1e40af;font-weight:700}'
    + 'tr:last-child td{border-bottom:none}'
    + '.emp-ftr{display:flex;justify-content:space-between;align-items:center;background:#f8fafc;border-top:1px solid #e2e8f0;padding:6px 12px;font-size:11px;color:#64748b}'
    + '.sal{color:#059669;font-weight:700;font-size:13px}'
    + '.grand{display:flex;justify-content:space-between;align-items:center;background:#1e40af;color:#fff;border-radius:8px;padding:11px 16px;margin-top:4px}'
    + '.grand .gl{font-size:13px;font-weight:600}'
    + '.grand .ga{font-size:15px;font-weight:700}'
    + '.foot{text-align:right;color:#94a3b8;font-size:9px;margin-top:12px}'
    + '@media print{'
    + 'body{padding:10px}'
    + '.no-print{display:none!important}'
    + '.card{page-break-inside:avoid}'
    + '}'
    + '</style>'
    + '</head><body>'
    + '<div class="no-print" style="text-align:center;margin-bottom:16px;">'
    + '<button onclick="window.print()" style="background:#1e40af;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-right:8px">⬇️ Guardar como PDF</button>'
    + '<button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">✕ Cerrar</button>'
    + '<p style="margin-top:8px;font-size:11px;color:#64748b;">En el dialogo de impresion elige <b>Guardar como PDF</b></p>'
    + '</div>'
    + '<div class="hdr"><h1>Reporte de Planilla Semanal</h1><p>Semana: ' + weekLabel + '</p></div>'
    + cardsHTML
    + '<div class="grand"><span class="gl">Total Planilla \u2014 ' + grandHours.toFixed(1) + ' hrs</span><span class="ga">' + fmt(grandTotal) + '</span></div>'
    + '<p class="foot">Generado el ' + now + ' \u00B7 Control de Horas</p>'
    + '<script>window.onload=function(){window.print()}<\/script>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if (!win) {
    showToast('Permite ventanas emergentes para generar el PDF', 'error');
    return;
  }
  win.document.write(html);
  win.document.close();
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

  // Conectar Firebase, cargar tarifas y datos
  initializeFirebase();

  // Auto-guardado cada 5 segundos
  // PROTEGIDO: solo guarda si firebaseLoadComplete === true
  autoSaveInterval = setInterval(autoSave, 5000);

  window.addEventListener("beforeunload", () => {
    if (!firebaseLoadComplete) return; // no guardar si no cargó
    collectCurrentDayFromDOM();
    if (firebaseConnected) {
      const key = generateWeekKey();
      navigator.sendBeacon &&
        db &&
        fetch(
          "https://firestore.googleapis.com/v1/projects/programa-horas-trabajo/databases/(default)/documents/weeks/" +
            key,
          {
            method: "PATCH",
            body: JSON.stringify({
              fields: {
                data: { stringValue: JSON.stringify(weekData) },
                updatedAt: { integerValue: Date.now().toString() },
              },
            }),
            keepalive: true,
          }
        );
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);