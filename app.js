/**
 * STATE MANAGEMENT
 */
let backlogTasks = [];
let scheduledTasks = []; // { id, title, duration, startSlotIdx, dateStr }
let recurringBlocks = []; // { id, title, startSlotIdx, duration, days: [] }
let dragSourceId = null;

let selectedDateStr = '';
let weekDates = [];

function toYYYYMMDD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const STORAGE_KEY = 'chronoAI_state';

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            backlogTasks = parsed.backlogTasks || [];
            recurringBlocks = parsed.recurringBlocks || [];

            // Purge past tasks
            const todayStr = toYYYYMMDD(new Date());
            scheduledTasks = (parsed.scheduledTasks || []).filter(t => t.dateStr >= todayStr);
        } catch (e) {
            console.error("Failed to load state", e);
        }
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        backlogTasks,
        scheduledTasks,
        recurringBlocks
    }));
}

// Settings
const SCHEDULE_START_HOUR = 6; // 6 AM
const SCHEDULE_END_HOUR = 24; // Midnight
const SLOTS_PER_HOUR = 2; // 30 min intervals
const TOTAL_SLOTS = (SCHEDULE_END_HOUR - SCHEDULE_START_HOUR) * SLOTS_PER_HOUR;
const SLOT_DURATION_MINS = 60 / SLOTS_PER_HOUR;

/**
 * DOM ELEMENTS
 */
const dateDisplay = document.getElementById('current-date');
const dayDisplay = document.getElementById('current-day');
const taskForm = document.getElementById('add-task-form');
const taskNameInput = document.getElementById('task-name');
const backlogList = document.getElementById('backlog-list');
const backlogCount = document.getElementById('backlog-count');
const timeline = document.getElementById('timeline');
const autoScheduleBtn = document.getElementById('ai-schedule-btn');
const clearScheduleBtn = document.getElementById('clear-schedule-btn');
const processingOverlay = document.getElementById('ai-processing-overlay');
const dayNavigator = document.getElementById('day-navigator');

/**
 * INITIALIZATION
 */
function init() {
    setupDates();
    loadState();
    generateTimeline();
    renderBacklog();
    renderDays();
    renderSchedule();
    setupEventListeners();
}

/**
 * STARTUP LOGIC
 */
function setupDates() {
    const now = new Date();
    weekDates = [];
    for (let i = 0; i < 7; i++) {
        let d = new Date();
        d.setDate(now.getDate() + i);
        weekDates.push(d);
    }
    selectedDateStr = toYYYYMMDD(weekDates[0]);
    updateDateDisplay();
}

function updateDateDisplay() {
    const dateObj = weekDates.find(d => toYYYYMMDD(d) === selectedDateStr) || new Date();
    const optionsDate = { month: 'long', day: 'numeric' };
    const optionsDay = { weekday: 'long', year: 'numeric' };

    dateDisplay.textContent = dateObj.toLocaleDateString(undefined, optionsDate);
    dayDisplay.textContent = dateObj.toLocaleDateString(undefined, optionsDay);
}

function renderDays() {
    dayNavigator.innerHTML = '';
    const daysArr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    weekDates.forEach((d, i) => {
        const dStr = toYYYYMMDD(d);
        const tab = document.createElement('div');
        tab.className = `day-tab ${dStr === selectedDateStr ? 'active' : ''}`;

        const tabName = i === 0 ? 'Today' : daysArr[d.getDay()];

        tab.innerHTML = `
            <span class="tab-name">${tabName}</span>
            <span class="tab-date">${d.getDate()}</span>
        `;

        tab.addEventListener('click', () => {
            selectedDateStr = dStr;
            updateDateDisplay();
            renderDays();
            renderSchedule();
        });

        dayNavigator.appendChild(tab);
    });
}

function generateTimeline() {
    timeline.innerHTML = ''; // Clear existing

    for (let i = 0; i < TOTAL_SLOTS; i++) {
        const slotDiv = document.createElement('div');
        slotDiv.className = 'time-slot';
        slotDiv.dataset.index = i;

        const hourTime = SCHEDULE_START_HOUR + Math.floor(i / SLOTS_PER_HOUR);
        const minsTime = (i % SLOTS_PER_HOUR) * SLOT_DURATION_MINS;

        const ampm = hourTime >= 12 ? 'PM' : 'AM';
        const displayHour = hourTime > 12 ? hourTime - 12 : (hourTime === 0 ? 12 : hourTime);
        const displayMins = minsTime === 0 ? '00' : minsTime;
        const timeString = `${displayHour}:${displayMins} ${ampm}`;

        if (minsTime === 0) {
            slotDiv.classList.add('hour-marker');
        }

        slotDiv.innerHTML = `
            <div class="slot-time">${timeString}</div>
            <div class="slot-content dropzone" data-index="${i}"></div>
        `;

        const dropzone = slotDiv.querySelector('.slot-content');
        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('dragleave', handleDragLeave);
        dropzone.addEventListener('drop', handleDrop);

        timeline.appendChild(slotDiv);
    }
}

/**
 * EVENT LISTENERS & ROUTINES MODAL
 */
function setupEventListeners() {
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = taskNameInput.value.trim();
        const durationNode = document.querySelector('input[name="duration"]:checked');
        const duration = parseInt(durationNode.value, 10);

        if (name) {
            addTaskToBacklog(name, duration);
            taskForm.reset();
            document.querySelector('input[name="duration"][value="30"]').checked = true;
        }
    });

    autoScheduleBtn.addEventListener('click', handleAutoSchedule);

    clearScheduleBtn.addEventListener('click', () => {
        const tasksForDay = scheduledTasks.filter(t => t.dateStr === selectedDateStr);
        tasksForDay.forEach(st => {
            backlogTasks.push({
                id: st.id,
                title: st.title,
                duration: st.duration
            });
        });
        scheduledTasks = scheduledTasks.filter(t => t.dateStr !== selectedDateStr);
        saveState();
        renderBacklog();
        renderSchedule();
    });

    // Routines Modal
    const manageRoutinesBtn = document.getElementById('manage-routines-btn');
    const routinesModal = document.getElementById('routines-modal');
    const closeRoutinesBtn = document.getElementById('close-routines-btn');
    const addRoutineForm = document.getElementById('add-routine-form');

    manageRoutinesBtn.addEventListener('click', () => {
        routinesModal.classList.remove('hidden');
        renderRoutinesList();
    });

    closeRoutinesBtn.addEventListener('click', () => {
        routinesModal.classList.add('hidden');
    });

    // Populate routine-start dropdown
    const routineStartSelect = document.getElementById('routine-start');
    for (let i = 0; i < TOTAL_SLOTS; i++) {
        const hourTime = SCHEDULE_START_HOUR + Math.floor(i / SLOTS_PER_HOUR);
        const minsTime = (i % SLOTS_PER_HOUR) * SLOT_DURATION_MINS;
        const ampm = hourTime >= 12 ? 'PM' : 'AM';
        const displayHour = hourTime > 12 ? hourTime - 12 : (hourTime === 0 ? 12 : hourTime);
        const displayMins = minsTime === 0 ? '00' : String(minsTime).padStart(2, '0');

        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${displayHour}:${displayMins} ${ampm}`;
        routineStartSelect.appendChild(option);
    }

    addRoutineForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('routine-name').value.trim();
        const startSlotIdx = parseInt(routineStartSelect.value, 10);
        const duration = parseInt(document.getElementById('routine-duration').value, 10);

        const dayCheckboxes = document.querySelectorAll('.days-selector input[type="checkbox"]:checked');
        const days = Array.from(dayCheckboxes).map(cb => parseInt(cb.value, 10));

        if (title && days.length > 0) {
            recurringBlocks.push({
                id: generateId(),
                title,
                startSlotIdx,
                duration,
                days
            });
            saveState();
            addRoutineForm.reset();
            renderRoutinesList();
            renderSchedule();
        } else {
            alert('Please fill out all fields and select at least one day.');
        }
    });
}

/**
 * ROUTINES LOGIC
 */
function renderRoutinesList() {
    const list = document.getElementById('routines-list');
    list.innerHTML = '';

    if (recurringBlocks.length === 0) {
        list.innerHTML = '<div class="empty-state">No routines set</div>';
        return;
    }

    const daysArr = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    recurringBlocks.forEach(rt => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.style.cursor = 'default';

        const daysStr = rt.days.map(d => daysArr[d]).join(', ');

        const hour = SCHEDULE_START_HOUR + Math.floor(rt.startSlotIdx / SLOTS_PER_HOUR);
        const min = (rt.startSlotIdx % SLOTS_PER_HOUR) * SLOT_DURATION_MINS;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHr = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        const padMin = String(min).padStart(2, '0');

        card.innerHTML = `
            <div class="task-info">
                <span class="task-name">${rt.title}</span>
                <button class="delete-task" title="Remove" aria-label="Remove Routine">
                    <i class="ph ph-x"></i>
                </button>
            </div>
            <div class="task-meta">
                <span style="margin-right: 1rem;"><i class="ph ph-calendar"></i> ${daysStr}</span>
                <span><i class="ph ph-clock"></i> ${displayHr}:${padMin} ${ampm} (${rt.duration >= 60 ? rt.duration / 60 + 'h' : rt.duration + 'm'})</span>
            </div>
        `;

        card.querySelector('.delete-task').addEventListener('click', () => {
            recurringBlocks = recurringBlocks.filter(r => r.id !== rt.id);
            saveState();
            renderRoutinesList();
            renderSchedule();
        });

        list.appendChild(card);
    });
}


/**
 * BACKLOG LOGIC
 */
function generateId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

function addTaskToBacklog(title, duration) {
    const task = {
        id: generateId(),
        title,
        duration
    };
    backlogTasks.push(task);
    saveState();
    renderBacklog();
}

function removeTaskFromBacklog(id) {
    backlogTasks = backlogTasks.filter(t => t.id !== id);
    saveState();
    renderBacklog();
}

function renderBacklog() {
    backlogCount.textContent = backlogTasks.length;

    if (backlogTasks.length === 0) {
        backlogList.innerHTML = '<div class="empty-state">No boxes pending</div>';
        return;
    }

    backlogList.innerHTML = '';

    backlogTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.dataset.id = task.id;

        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        card.innerHTML = `
            <div class="task-info">
                <span class="task-name">${task.title}</span>
                <button class="delete-task" title="Remove" aria-label="Remove Task">
                    <i class="ph ph-x"></i>
                </button>
            </div>
            <div class="task-meta">
                <span class="task-duration">
                    <i class="ph ph-clock"></i>
                    ${task.duration >= 60 ? (task.duration / 60) + 'h' : task.duration + 'm'}
                </span>
            </div>
        `;

        const deleteBtn = card.querySelector('.delete-task');
        deleteBtn.addEventListener('click', () => {
            removeTaskFromBacklog(task.id);
        });

        backlogList.appendChild(card);
    });
}

/**
 * DRAG AND DROP
 */
function handleDragStart(e) {
    dragSourceId = e.currentTarget.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSourceId);

    setTimeout(() => {
        e.target.style.opacity = '0.5';
    }, 0);
}

function handleDragEnd(e) {
    e.target.style.opacity = '1';
    dragSourceId = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dropzone = e.target.closest('.slot-content');
    if (dropzone) {
        dropzone.classList.add('drag-over');
    }
    return false;
}

function handleDragLeave(e) {
    const dropzone = e.target.closest('.slot-content');
    if (dropzone) dropzone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation();
    const dropzone = e.target.closest('.slot-content');
    if (dropzone) {
        dropzone.classList.remove('drag-over');
        const slotIdx = parseInt(dropzone.dataset.index, 10);

        if (dragSourceId) {
            scheduleTaskAt(dragSourceId, slotIdx);
        }
    }
    return false;
}

/**
 * SCHEDULING LOGIC
 */
function getDayOfWeekFromDateStr(dateStr) {
    const d = weekDates.find(wd => toYYYYMMDD(wd) === dateStr);
    return d ? d.getDay() : new Date(dateStr).getDay();
}

function hasCollision(targetSlotIdx, requiredSlots, targetDateStr, excludeTaskId = null) {
    const dayOfWeek = getDayOfWeekFromDateStr(targetDateStr);

    for (let j = 0; j < requiredSlots; j++) {
        const checkIdx = targetSlotIdx + j;

        let collidesWithTask = scheduledTasks.some(st => {
            if (st.id === excludeTaskId) return false;
            if (st.dateStr !== targetDateStr) return false;
            const stSlots = st.duration / SLOT_DURATION_MINS;
            return checkIdx >= st.startSlotIdx && checkIdx < (st.startSlotIdx + stSlots);
        });
        if (collidesWithTask) return true;

        let collidesWithRoutine = recurringBlocks.some(rt => {
            if (!rt.days.includes(dayOfWeek)) return false;
            const rtSlots = rt.duration / SLOT_DURATION_MINS;
            return checkIdx >= rt.startSlotIdx && checkIdx < (rt.startSlotIdx + rtSlots);
        });
        if (collidesWithRoutine) return true;
    }
    return false;
}

function scheduleTaskAt(taskId, startSlotIdx) {
    let task = backlogTasks.find(t => t.id === taskId);

    if (task) {
        backlogTasks = backlogTasks.filter(t => t.id !== taskId);
    } else {
        task = scheduledTasks.find(t => t.id === taskId);
        if (task) {
            scheduledTasks = scheduledTasks.filter(t => t.id !== taskId);
        } else {
            return;
        }
    }

    const requiredSlots = task.duration / SLOT_DURATION_MINS;

    if (startSlotIdx + requiredSlots > TOTAL_SLOTS) {
        alert("Not enough time left in the day for this task!");
        if (!backlogTasks.find(t => t.id === task.id)) backlogTasks.push(task);
        saveState();
        renderBacklog();
        return;
    }

    const dayOfWeek = getDayOfWeekFromDateStr(selectedDateStr);
    let routineOverlap = false;

    for (let j = 0; j < requiredSlots; j++) {
        const checkIdx = startSlotIdx + j;
        let collides = recurringBlocks.some(rt => {
            if (!rt.days.includes(dayOfWeek)) return false;
            const rtSlots = rt.duration / SLOT_DURATION_MINS;
            return checkIdx >= rt.startSlotIdx && checkIdx < (rt.startSlotIdx + rtSlots);
        });
        if (collides) {
            routineOverlap = true; break;
        }
    }

    if (routineOverlap) {
        alert("Cannot schedule here. Overlaps with a locked routine!");
        if (!backlogTasks.find(t => t.id === task.id)) backlogTasks.push(task);
        saveState(); renderBacklog(); return;
    }

    const collidingTasks = scheduledTasks.filter(st => {
        if (st.dateStr !== selectedDateStr) return false;
        const stRequired = st.duration / SLOT_DURATION_MINS;
        return startSlotIdx < (st.startSlotIdx + stRequired) && (startSlotIdx + requiredSlots) > st.startSlotIdx;
    });

    if (collidingTasks.length > 0) {
        collidingTasks.forEach(ct => {
            scheduledTasks = scheduledTasks.filter(s => s.id !== ct.id);
            backlogTasks.push({ id: ct.id, title: ct.title, duration: ct.duration });
        });
    }

    scheduledTasks.push({
        id: task.id,
        title: task.title,
        duration: task.duration,
        startSlotIdx,
        dateStr: selectedDateStr
    });

    saveState();
    renderBacklog();
    renderSchedule();
}

/**
 * AI AUTO-SCHEDULE
 */
function handleAutoSchedule() {
    if (backlogTasks.length === 0) return;

    processingOverlay.classList.remove('hidden');

    setTimeout(() => {
        const tasksToSchedule = [...backlogTasks].sort((a, b) => b.duration - a.duration);

        tasksToSchedule.forEach(task => {
            const requiredSlots = task.duration / SLOT_DURATION_MINS;
            let bestSlotIdx = -1;
            let bestDateStr = null;

            let startIndex = weekDates.findIndex(wd => toYYYYMMDD(wd) === selectedDateStr);
            if (startIndex === -1) startIndex = 0;

            for (let d = startIndex; d < weekDates.length; d++) {
                const searchDateStr = toYYYYMMDD(weekDates[d]);
                for (let i = 0; i <= TOTAL_SLOTS - requiredSlots; i++) {
                    if (!hasCollision(i, requiredSlots, searchDateStr)) {
                        bestSlotIdx = i;
                        bestDateStr = searchDateStr;
                        break;
                    }
                }
                if (bestSlotIdx !== -1) break;
            }

            if (bestSlotIdx !== -1) {
                backlogTasks = backlogTasks.filter(t => t.id !== task.id);
                scheduledTasks.push({
                    id: task.id,
                    title: task.title,
                    duration: task.duration,
                    startSlotIdx: bestSlotIdx,
                    dateStr: bestDateStr
                });
            }
        });

        processingOverlay.classList.add('hidden');
        saveState();
        renderBacklog();
        renderSchedule();

    }, 1200);
}

/**
 * RENDER SCHEDULE
 */
function renderSchedule() {
    document.querySelectorAll('.scheduled-block').forEach(b => b.remove());

    const renderBlock = (taskObj, isRoutine) => {
        const slotEl = document.querySelector(`.time-slot[data-index="${taskObj.startSlotIdx}"]`);
        if (!slotEl) return;

        const dropzone = slotEl.querySelector('.slot-content');

        const block = document.createElement('div');
        block.className = `scheduled-block ${isRoutine ? 'recurring-block' : ''}`;

        if (!isRoutine) {
            block.draggable = true;
            block.dataset.id = taskObj.id;
            block.addEventListener('dragstart', handleDragStart);
            block.addEventListener('dragend', handleDragEnd);
        }

        const requiredSlots = taskObj.duration / SLOT_DURATION_MINS;
        block.style.height = `calc(${requiredSlots * 60}px - 2px)`;

        const hour = SCHEDULE_START_HOUR + Math.floor(taskObj.startSlotIdx / SLOTS_PER_HOUR);
        const min = (taskObj.startSlotIdx % SLOTS_PER_HOUR) * SLOT_DURATION_MINS;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHr = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        const padMin = String(min).padStart(2, '0');

        block.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                <div class="task-title" style="${taskObj.completed ? 'text-decoration: line-through;' : ''}">${isRoutine ? '<i class="ph ph-lock-key"></i> ' : ''}${taskObj.title}</div>
                ${!isRoutine ? `<button class="complete-btn btn-ghost" style="padding: 0; min-width: auto; color: ${taskObj.completed ? 'var(--accent)' : 'var(--text-tertiary)'}; border: none; font-size: 1.1rem;"><i class="ph ${taskObj.completed ? 'ph-check-circle-fill' : 'ph-circle'}"></i></button>` : ''}
            </div>
            <div class="task-time">${displayHr}:${padMin} ${ampm} (${taskObj.duration >= 60 ? taskObj.duration / 60 + 'h' : taskObj.duration + 'm'})</div>
        `;

        if (!isRoutine) {
            const btn = block.querySelector('.complete-btn');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                taskObj.completed = !taskObj.completed;
                saveState();
                renderSchedule();
            });
        }

        dropzone.appendChild(block);
    }

    scheduledTasks.filter(t => t.dateStr === selectedDateStr).forEach(t => renderBlock(t, false));

    const dayOfWeek = getDayOfWeekFromDateStr(selectedDateStr);
    recurringBlocks.filter(rt => rt.days.includes(dayOfWeek)).forEach(rt => renderBlock(rt, true));
}

// Bootstrap Program
document.addEventListener('DOMContentLoaded', init);
