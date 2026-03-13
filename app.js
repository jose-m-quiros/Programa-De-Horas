/* ============================================
   Control de Horas - App v3
   Navegación por día
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
let selectedDayIndex = 0; // 0=Lunes ... 6=Domingo
let weekData = {}; // { employeeId: { dayIndex: { entry, exit } } }
let db = null;
let firebaseConnected = false;
let autoSaveInterval = null;
let expandedCards = {}; // track which employee cards are expanded

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
    // Cargar datos desde Firebase al conectar
    await loadDataFromFirebase();
  } catch (e) {
    firebaseConnected = false;
    updateCloudStatus("disconnected", "Error de conexión");
  }
}

function updateCloudStatus(status, text) {
  const el = document.getElementById("cloudStatus");
  if (!el) return;
  el.className = "cloud-status " + status;
  el.innerHTML = '<span class="cloud-dot"></span> ' + text;
}

async function saveToCloud(key, data) {
  if (!db || !firebaseConnected) return;
  try {
    updateCloudStatus("syncing", "Sincronizando...");
    await db
      .collection("weeks")
      .doc(key)
      .set({ data: JSON.stringify(data), updatedAt: Date.now() });
    updateCloudStatus("connected", "Nube sincronizada");
  } catch (e) {
    updateCloudStatus("disconnected", "Error al guardar");
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
  const cloud = await loadFromCloud();
  if (cloud) {
    weekData = cloud;
    initWeekData();
  } else {
    weekData = {};
    initWeekData();
  }
  renderAll();
  updateLastSaved();
}

// ==========================================
// Funciones de fecha y semana
// Zona horaria: Costa Rica (America/Costa_Rica, UTC-6)
// ==========================================
function getNowCostaRica() {
  // Retorna un objeto Date ajustado a la hora de Costa Rica
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
  return day === 0 ? 6 : day - 1; // 0=Monday ... 6=Sunday
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
  // Read current DOM inputs into weekData
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
// Guardado (Firebase únicamente)
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
    showToast("Datos guardados en Firebase", "success");
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

  // Week label
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
    const isExpanded = expandedCards[emp.id] !== false; // default expanded

    html += '<div class="employee-card' + (emp.isBoss ? " boss" : "") + '">';

    // Header - clickable to expand/collapse
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

    // Content - expandable
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

    // Mini summary at bottom
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

    html += "</div>"; // employee-content
    html += "</div>"; // employee-card
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

  // Update weekData
  if (!weekData[empId]) weekData[empId] = {};
  weekData[empId][selectedDayIndex] = {
    entry: entryEl.value || "",
    exit: exitEl.value || "",
  };

  // Update day hours display
  const hrs = calculateHoursBetween(entryEl.value, exitEl.value);
  const hrsEl = document.getElementById("dayHours_" + empId);
  if (hrsEl) hrsEl.textContent = hrs.toFixed(1) + " horas";

  // Update header totals and summary without full re-render
  updateWeeklySummary();
  renderWeekDots();

  // Guardar en Firebase
  if (firebaseConnected) {
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
// Reporte Semanal
// ==========================================
function generateWeeklyReport() {
  collectCurrentDayFromDOM();

  const monday = getMondayOfWeek(getNowCostaRica());
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  let html = "<h2>📊 Reporte Semanal</h2>";
  html +=
    '<p style="color:#94a3b8;margin-bottom:15px;">' +
    formatDate(monday) +
    " - " +
    formatDate(sunday) +
    "</p>";

  let grandTotal = 0;

  EMPLOYEES.forEach((emp) => {
    const weekHrs = getWeekTotals(emp.id);
    const salary = weekHrs * emp.rate;
    grandTotal += salary;

    html +=
      '<div style="background:#0f172a;border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid ' +
      (emp.isBoss ? "#fbbf24" : "#3b82f6") +
      '33;">';
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html +=
      '<strong style="color:#f1f5f9;">' +
      emp.emoji +
      " " +
      emp.name +
      "</strong>";
    html +=
      '<span style="color:#34d399;font-weight:bold;">₡' +
      salary.toLocaleString() +
      "</span>";
    html += "</div>";
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';

    for (let d = 0; d < 7; d++) {
      const dayHrs = getDayHours(emp.id, d);
      const bg = dayHrs > 0 ? "rgba(59,130,246,0.2)" : "rgba(15,23,42,0.5)";
      const color = dayHrs > 0 ? "#60a5fa" : "#475569";
      html +=
        '<div style="flex:1;min-width:40px;text-align:center;padding:4px;background:' +
        bg +
        ';border-radius:6px;">';
      html +=
        '<div style="font-size:0.6rem;color:#94a3b8;">' +
        DAY_SHORT[d] +
        "</div>";
      html +=
        '<div style="font-size:0.85rem;font-weight:bold;color:' +
        color +
        ';">' +
        dayHrs.toFixed(1) +
        "</div>";
      html += "</div>";
    }

    html += "</div>";
    html +=
      '<div style="text-align:right;margin-top:6px;color:#94a3b8;font-size:0.8rem;">Total: ' +
      weekHrs.toFixed(1) +
      " hrs × ₡" +
      emp.rate.toLocaleString() +
      "</div>";
    html += "</div>";
  });

  html +=
    '<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:10px;padding:15px;margin-top:10px;display:flex;justify-content:space-between;color:white;">';
  html +=
    '<strong style="font-size:1.1rem;">💰 Total Planilla Semanal</strong>';
  html +=
    '<strong style="font-size:1.2rem;">₡' +
    grandTotal.toLocaleString() +
    "</strong>";
  html += "</div>";

  showReportModal(html);
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
    '<div class="modal-actions"><button class="btn-save" onclick="this.closest(\'.modal-overlay\').remove()">Cerrar</button></div>';
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
      "🚨 SEGUNDA CONFIRMACIÓN: ¿Está SEGURO? Esta acción NO se puede deshacer.",
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
// Reinicio semanal automático
// El reseteo se maneja automáticamente por la clave de semana.
// Cada semana genera una clave diferente (week_YYYY-MM-DD),
// entonces al cambiar de semana Firebase devuelve vacío = semana nueva.
// ==========================================

// ==========================================
// Inicialización
// ==========================================
async function init() {
  selectedDayIndex = getTodayDayIndex();

  // Initialize expand state (all expanded by default)
  EMPLOYEES.forEach((emp) => {
    expandedCards[emp.id] = true;
  });

  // Inicializar datos vacíos mientras carga Firebase
  weekData = {};
  initWeekData();
  renderAll();

  // Conectar Firebase y cargar datos
  initializeFirebase();

  // Auto-guardado en Firebase cada 5 segundos
  autoSaveInterval = setInterval(autoSave, 5000);

  // Guardar en Firebase antes de cerrar la página
  window.addEventListener("beforeunload", () => {
    collectCurrentDayFromDOM();
    if (firebaseConnected) {
      const key = generateWeekKey();
      // Intento sincrónico best-effort
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
          },
        );
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);
