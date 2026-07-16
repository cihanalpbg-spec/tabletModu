// APP STATE
let activeLang = 'english';
let activeLangName = 'İngilizce';
let themeColor = 'blue';
let chalkboardMode = false;
let wordsDatabase = [];
let reportsDatabase = [];
let activePage = 'screen-home';

// Selection & Text Coloring State
let selectedRange = null;

// Virtual Keyboard State
let activeFocusedInput = null;

// Drawing State
let drawingStates = {}; // key: row-col, val: strokes or image data
let isDrawing = false;
let currentCanvas = null;
let currentCtx = null;
let lastX = 0;
let lastY = 0;

// Test & Game State
let currentGameType = '';
let gameScore = 0;
let hangmanWord = null;
let hangmanGuesses = [];
let hangmanLives = 6;
let matchingPairs = [];
let matchingSelected = null;
let currentTestWord = null;
let currentTestChoices = [];
let timedTimerId = null;
let timedDuration = 5; // Default 5 seconds
let memoryTimerId = null;
let memoryDirection = 'en-tr'; // en-tr or tr-en

// INDEXEDDB ENGINE
const DB_NAME = 'TabletKelimeDB';
const DB_VERSION = 1;
let db = null;

function checkAndLoadPreloadedWords(callback) {
    if (localStorage.getItem('preloaded_loaded') === 'true') {
        if (callback) callback();
        return;
    }
    
    fetch('preloaded_words.json')
        .then(response => {
            if (!response.ok) {
                throw new Error("No preloaded words file found.");
            }
            return response.json();
        })
        .then(data => {
            if (data && Array.isArray(data.words) && data.words.length > 0) {
                console.log("Preloaded words found. Saving to IndexedDB...", data.words.length);
                saveWords(data.words, () => {
                    localStorage.setItem('preloaded_loaded', 'true');
                    console.log("Preloaded words saved successfully.");
                    if (callback) callback();
                });
            } else {
                if (callback) callback();
            }
        })
        .catch(err => {
            console.log("Preloaded words check finished:", err.message);
            if (callback) callback();
        });
}

function initDB(callback) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = function(event) {
        console.error("IndexedDB load error:", event);
        alert("Veritabanı açılamadı! LocalStorage yedek moduna geçiliyor.");
        if (callback) callback();
    };
    
    request.onsuccess = function(event) {
        db = event.target.result;
        console.log("IndexedDB loaded successfully.");
        checkAndLoadPreloadedWords(() => {
            if (callback) callback();
        });
    };
    
    request.onupgradeneeded = function(event) {
        const dbInstance = event.target.result;
        
        // Words store: stores saved word templates
        if (!dbInstance.objectStoreNames.contains('words')) {
            const wordsStore = dbInstance.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
            wordsStore.createIndex('language', 'language', { unique: false });
            wordsStore.createIndex('date', 'date', { unique: false });
            wordsStore.createIndex('wordText', 'wordText', { unique: false });
        }
        
        // Reports store: stores daily statistics
        if (!dbInstance.objectStoreNames.contains('reports')) {
            dbInstance.createObjectStore('reports', { keyPath: 'date' });
        }
    };
}

// DB OPERATIONS
function getWords(callback) {
    if (!db) {
        const localData = JSON.parse(localStorage.getItem('words_backup') || '[]');
        wordsDatabase = localData;
        if (callback) callback(localData);
        return;
    }
    
    const transaction = db.transaction(['words'], 'readonly');
    const store = transaction.objectStore(transaction.objectStoreNames[0]);
    const request = store.getAll();
    
    request.onsuccess = function(event) {
        wordsDatabase = event.target.result;
        if (callback) callback(wordsDatabase);
    };
}

function saveWords(wordsArray, callback) {
    if (!db) {
        localStorage.setItem('words_backup', JSON.stringify(wordsArray));
        if (callback) callback();
        return;
    }
    
    const transaction = db.transaction(['words'], 'readwrite');
    const store = transaction.objectStore('words');
    
    let completedCount = 0;
    const total = wordsArray.length;
    
    if (total === 0) {
        if (callback) callback();
        return;
    }

    wordsArray.forEach(wordObj => {
        const req = store.put(wordObj);
        req.onsuccess = function() {
            completedCount++;
            if (completedCount === total && callback) {
                callback();
            }
        };
    });
}

function deleteWord(id, callback) {
    // Log words deleted in reports
    logReportActivity('deleteWord');
    
    if (!db) {
        wordsDatabase = wordsDatabase.filter(w => w.id !== id);
        localStorage.setItem('words_backup', JSON.stringify(wordsDatabase));
        if (callback) callback();
        return;
    }
    
    const transaction = db.transaction(['words'], 'readwrite');
    const store = transaction.objectStore('words');
    const request = store.delete(id);
    
    request.onsuccess = function() {
        if (callback) callback();
    };
}

// DAILY REPORT ENGINE
function getTodayDateStr() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function logReportActivity(type, extra = 1) {
    const todayStr = getTodayDateStr();
    
    getReports(reports => {
        let dayLog = reports.find(r => r.date === todayStr);
        if (!dayLog) {
            dayLog = {
                date: todayStr,
                wordsWritten: 0,
                testsSolved: 0,
                correctAnswers: 0,
                incorrectAnswers: 0
            };
        }
        
        if (type === 'wordWritten') {
            dayLog.wordsWritten += extra;
        } else if (type === 'testSolved') {
            dayLog.testsSolved += extra;
        } else if (type === 'testResult') {
            dayLog.testsSolved += 1;
            if (extra === 'correct') {
                dayLog.correctAnswers += 1;
            } else {
                dayLog.incorrectAnswers += 1;
            }
        }
        
        saveReport(dayLog, () => {
            updateReportUI();
        });
    });
}

function getReports(callback) {
    if (!db) {
        const rep = JSON.parse(localStorage.getItem('reports_backup') || '[]');
        reportsDatabase = rep;
        if (callback) callback(rep);
        return;
    }
    
    const transaction = db.transaction(['reports'], 'readonly');
    const store = transaction.objectStore('reports');
    const request = store.getAll();
    
    request.onsuccess = function(event) {
        reportsDatabase = event.target.result;
        if (callback) callback(reportsDatabase);
    };
}

function saveReport(reportObj, callback) {
    if (!db) {
        const rep = JSON.parse(localStorage.getItem('reports_backup') || '[]');
        const idx = rep.findIndex(r => r.date === reportObj.date);
        if (idx >= 0) rep[idx] = reportObj;
        else rep.push(reportObj);
        localStorage.setItem('reports_backup', JSON.stringify(rep));
        if (callback) callback();
        return;
    }
    
    const transaction = db.transaction(['reports'], 'readwrite');
    const store = transaction.objectStore('reports');
    const request = store.put(reportObj);
    
    request.onsuccess = function() {
        if (callback) callback();
    };
}

// APPLICATION INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    // Set Current Date on dashboard
    document.getElementById('current-date-str').textContent = getTodayDateStr();
    
    // Load Settings
    loadAppSettings();
    
    // Initialize Database
    initDB(() => {
        getWords(() => {
            getReports(() => {
                updateReportUI();
            });
        });
    });
    
    // Render Workspace (default)
    initChalkboardKeyboardBindings();
    initChalkboardCanvases();
    
    // Initialize Float Selection Color Listener
    initSelectionColorListener();
});

// LOAD & SAVE SETTINGS
function loadAppSettings() {
    themeColor = localStorage.getItem('theme_color') || 'blue';
    chalkboardMode = localStorage.getItem('chalkboard_mode') === 'true';
    const highlight = localStorage.getItem('highlightColor') || '#ff3b30';
    
    // Apply Settings
    setThemeColor(themeColor);
    setHighlightColor(highlight);
    document.getElementById('chalkboard-toggle').checked = chalkboardMode;
    if (chalkboardMode) {
        document.body.classList.add('chalkboard-mode');
        document.getElementById('chalkboard-status-label').textContent = "Karatahta Modu Açık";
    } else {
        document.body.classList.remove('chalkboard-mode');
        document.getElementById('chalkboard-status-label').textContent = "Karatahta Modu Kapalı";
    }
}

function setThemeColor(color) {
    themeColor = color;
    localStorage.setItem('theme_color', color);
    
    // Remove old themes
    document.body.classList.remove('theme-blue', 'theme-purple', 'theme-teal', 'theme-sepia', 'theme-orange');
    
    // Add selected
    document.body.classList.add('theme-' + color);
    
    // Toggle active classes on buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.classList.contains('theme-' + color)) {
            btn.classList.add('active');
        }
    });
}

function toggleChalkboardMode() {
    chalkboardMode = document.getElementById('chalkboard-toggle').checked;
    localStorage.setItem('chalkboard_mode', chalkboardMode);
    
    if (chalkboardMode) {
        document.body.classList.add('chalkboard-mode');
        document.getElementById('chalkboard-status-label').textContent = "Karatahta Modu Açık";
    } else {
        document.body.classList.remove('chalkboard-mode');
        document.getElementById('chalkboard-status-label').textContent = "Karatahta Modu Kapalı";
    }
}

// SCREEN NAVIGATION
function toggleSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    sidebar.classList.toggle('hidden');
    sidebar.classList.toggle('active');
}

function switchScreen(screenId) {
    // Hide active keyboards & formatting tools
    toggleVirtualKeyboard(false);
    hideColorPicker();
    
    // Switch screens
    document.querySelectorAll('.screen').forEach(scr => {
        scr.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    activePage = screenId;
    
    // Manage Sidebar active menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (screenId === 'screen-dashboard') {
        document.getElementById('menu-dash').classList.add('active');
    } else if (screenId === 'screen-word-lists') {
        document.getElementById('menu-lists').classList.add('active');
        loadAlphabeticalList();
    } else if (screenId === 'screen-archive') {
        document.getElementById('menu-archive').classList.add('active');
        loadArchiveList();
    } else if (screenId === 'screen-tests') {
        document.getElementById('menu-tests').classList.add('active');
        checkTestLockStatus();
    } else if (screenId === 'screen-reports') {
        document.getElementById('menu-reports').classList.add('active');
        updateReportUI();
    } else if (screenId === 'screen-settings') {
        document.getElementById('menu-settings').classList.add('active');
    }
    
    // Close sidebar on mobile
    if (window.innerWidth <= 900) {
        const sidebar = document.getElementById('app-sidebar');
        sidebar.classList.add('hidden');
        sidebar.classList.remove('active');
    }
}

function goHome() {
    switchScreen('screen-home');
    document.getElementById('app-sidebar').classList.add('hidden');
    document.getElementById('app-sidebar').classList.remove('active');
}

function selectLanguage(langCode, langName) {
    activeLang = langCode;
    activeLangName = langName;
    document.getElementById('dashboard-title').textContent = `${langName} Çalışma Masası`;
    
    // Unhide Sidebar
    document.getElementById('app-sidebar').classList.remove('hidden');
    
    // Reset database cache & load workspace
    getWords(() => {
        switchScreen('screen-dashboard');
    });
}

// 20-ROW WORD TEMPLATE GENERATION
function generateWorkspaceRows() {
    const tableBody = document.getElementById('table-body');
    const mobileContainer = document.getElementById('mobile-cards-container');
    
    tableBody.innerHTML = '';
    mobileContainer.innerHTML = '';
    
    const cols = ['word', 'pronunciation', 'meaning', 'memorySentence', 'synonyms', 'antonyms'];
    
    for (let r = 1; r <= 20; r++) {
        // Desktop Row
        const tr = document.createElement('tr');
        
        // Row Number
        const tdNum = document.createElement('td');
        tdNum.className = 'row-num';
        tdNum.textContent = r;
        tr.appendChild(tdNum);
        
        // Mobile Card Wrapper
        const card = document.createElement('div');
        card.className = 'mobile-row-card';
        card.innerHTML = `<div class="mobile-card-row-num">Satır ${r}</div>`;
        
        cols.forEach(col => {
            const cellId = `cell-${r}-${col}`;
            
            // --- Desktop Cell ---
            const td = document.createElement('td');
            const container = document.createElement('div');
            container.className = 'cell-container';
            container.id = `container-${cellId}`;
            
            // Text area
            const textDiv = document.createElement('div');
            textDiv.className = 'text-input';
            textDiv.contentEditable = 'true';
            textDiv.id = cellId;
            textDiv.placeholder = '...';
            
            // Canvas overlay
            const canvas = document.createElement('canvas');
            canvas.className = 'canvas-overlay hidden';
            canvas.id = `canvas-${cellId}`;
            
            // Controls
            const controls = document.createElement('div');
            controls.className = 'cell-controls';
            controls.innerHTML = `
                <button class="cell-btn btn-kbd active" onclick="toggleCellInputMode('${cellId}', 'kbd')" title="Klavye Girişi">⌨️</button>
                <button class="cell-btn btn-pen" onclick="toggleCellInputMode('${cellId}', 'pen')" title="Kalem Çizimi">✏️</button>
                <button class="cell-btn btn-cls hidden" onclick="clearCanvasCell('${cellId}')" title="Çizimi Temizle">🧹</button>
            `;
            
            container.appendChild(textDiv);
            container.appendChild(canvas);
            container.appendChild(controls);
            td.appendChild(container);
            tr.appendChild(td);
            
            // --- Mobile Card Field ---
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'mobile-field-group';
            
            const fieldLabel = document.createElement('span');
            fieldLabel.className = 'mobile-field-label';
            const labelMap = {
                word: 'KELİME',
                pronunciation: 'Türkçe Okunuşu',
                meaning: 'TÜRKÇE ANLAMI',
                memorySentence: 'HAFIZA CÜMLESİ',
                synonyms: 'Eş Anlamlıları',
                antonyms: 'Zıt Anlamlıları'
            };
            fieldLabel.textContent = labelMap[col];
            
            // Mobile clone element structure
            const mobileContainer = document.createElement('div');
            mobileContainer.className = 'cell-container';
            mobileContainer.id = `mob-container-${cellId}`;
            
            const mobTextDiv = document.createElement('div');
            mobTextDiv.className = 'text-input';
            mobTextDiv.contentEditable = 'true';
            mobTextDiv.id = `mob-${cellId}`;
            
            const mobCanvas = document.createElement('canvas');
            mobCanvas.className = 'canvas-overlay hidden';
            mobCanvas.id = `mob-canvas-${cellId}`;
            
            const mobControls = document.createElement('div');
            mobControls.className = 'cell-controls';
            mobControls.innerHTML = `
                <button class="cell-btn btn-kbd active" onclick="toggleCellInputMode('${cellId}', 'kbd')" title="Klavye">⌨️</button>
                <button class="cell-btn btn-pen" onclick="toggleCellInputMode('${cellId}', 'pen')" title="Kalem">✏️</button>
                <button class="cell-btn btn-cls hidden" onclick="clearCanvasCell('${cellId}')" title="Çizim Temizle">🧹</button>
            `;
            
            mobileContainer.appendChild(mobTextDiv);
            mobileContainer.appendChild(mobCanvas);
            mobileContainer.appendChild(mobControls);
            
            fieldGroup.appendChild(fieldLabel);
            fieldGroup.appendChild(mobileContainer);
            card.appendChild(fieldGroup);
            
            // Sync values between Desktop and Mobile clones
            textDiv.addEventListener('input', () => {
                mobTextDiv.innerHTML = textDiv.innerHTML;
            });
            mobTextDiv.addEventListener('input', () => {
                textDiv.innerHTML = mobTextDiv.innerHTML;
            });
            
            // Virtual Keyboard focus binder
            textDiv.addEventListener('focus', () => {
                activeFocusedInput = textDiv;
                openVirtualKeyboardForLang();
            });
            mobTextDiv.addEventListener('focus', () => {
                activeFocusedInput = mobTextDiv;
                openVirtualKeyboardForLang();
            });
        });
        
        tableBody.appendChild(tr);
        mobileContainer.appendChild(card);
    }
}

// TOGGLE CELL INPUT MODE (PEN VS KEYBOARD)
function toggleCellInputMode(cellId, mode) {
    const parentContainer = document.getElementById(`container-${cellId}`);
    if (!parentContainer) return;
    const textInput = document.getElementById(cellId);
    const canvas = document.getElementById(`canvas-${cellId}`);
    
    const btnKbd = parentContainer.querySelector('.btn-kbd');
    const btnPen = parentContainer.querySelector('.btn-pen');
    const btnCls = parentContainer.querySelector('.btn-cls');
    
    const mobParentContainer = document.getElementById(`mob-container-${cellId}`);
    const mobTextInput = document.getElementById(`mob-${cellId}`);
    const mobCanvas = document.getElementById(`mob-canvas-${cellId}`);
    
    const mobBtnKbd = mobParentContainer ? mobParentContainer.querySelector('.btn-kbd') : null;
    const mobBtnPen = mobParentContainer ? mobParentContainer.querySelector('.btn-pen') : null;
    const mobBtnCls = mobParentContainer ? mobParentContainer.querySelector('.btn-cls') : null;
    
    if (mode === 'pen') {
        if (textInput) textInput.classList.add('hidden');
        if (mobTextInput) mobTextInput.classList.add('hidden');
        if (canvas) canvas.classList.remove('hidden');
        if (mobCanvas) mobCanvas.classList.remove('hidden');
        
        if (btnKbd) btnKbd.classList.remove('active');
        if (mobBtnKbd) mobBtnKbd.classList.remove('active');
        if (btnPen) btnPen.classList.add('active');
        if (mobBtnPen) mobBtnPen.classList.add('active');
        if (btnCls) btnCls.classList.remove('hidden');
        if (mobBtnCls) mobBtnCls.classList.remove('hidden');
        
        // Setup Canvas elements
        if (canvas) setupCanvas(canvas, cellId);
        if (mobCanvas) setupCanvas(mobCanvas, cellId);
        
        // If there's an existing drawing, restore it
        if (drawingStates[cellId]) {
            if (canvas) restoreCanvasData(canvas, drawingStates[cellId]);
            if (mobCanvas) restoreCanvasData(mobCanvas, drawingStates[cellId]);
        }
    } else {
        if (textInput) textInput.classList.remove('hidden');
        if (mobTextInput) mobTextInput.classList.remove('hidden');
        if (canvas) canvas.classList.add('hidden');
        if (mobCanvas) mobCanvas.classList.add('hidden');
        
        if (btnPen) btnPen.classList.remove('active');
        if (mobBtnPen) mobBtnPen.classList.remove('active');
        if (btnKbd) btnKbd.classList.add('active');
        if (mobBtnKbd) mobBtnKbd.classList.add('active');
        if (btnCls) btnCls.classList.add('hidden');
        if (mobBtnCls) mobBtnCls.classList.add('hidden');
    }
}

function clearCanvasCell(cellId) {
    const canvas = document.getElementById(`canvas-${cellId}`);
    const mobCanvas = document.getElementById(`mob-canvas-${cellId}`);
    
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (mobCanvas) {
        const mobCtx = mobCanvas.getContext('2d');
        mobCtx.clearRect(0, 0, mobCanvas.width, mobCanvas.height);
    }
    
    delete drawingStates[cellId];
}

// CANVAS DRAWING ENGINE (TABLET PEN SUPPORT WITH INTEGRATED DRAG/TAP DETECTION)
let canvasStartPositions = {};

function setupCanvas(canvas, cellId) {
    // Set width and height explicitly based on bounds
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 200;
    canvas.height = rect.height || 60;
    
    const ctx = canvas.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    
    // Adjust brush style depending on chalkboard mode
    if (chalkboardMode) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; // Textured white chalk
        ctx.shadowBlur = 1;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    } else {
        ctx.strokeStyle = '#2c3e50'; // Dark ink pen
        ctx.shadowBlur = 0;
    }
    
    // Bind touch / mouse events with drag-detection
    canvas.addEventListener('pointerdown', (e) => {
        canvasStartPositions[cellId] = { x: e.clientX, y: e.clientY, isDrag: false };
        startDrawing(e, canvas, ctx);
    });
    
    canvas.addEventListener('pointermove', (e) => {
        if (isDrawing && canvasStartPositions[cellId]) {
            const start = canvasStartPositions[cellId];
            const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
            if (dist > 6) {
                start.isDrag = true;
            }
            draw(e, canvas, ctx, cellId);
        }
    });
    
    canvas.addEventListener('pointerup', (e) => {
        const start = canvasStartPositions[cellId];
        stopDrawing(canvas, cellId);
        
        if (start && !start.isDrag) {
            // Tap/Click: Focus the text-input underneath and place cursor at the end
            const textInput = document.getElementById(cellId);
            if (textInput) {
                textInput.focus();
                
                // Position caret at end of text input content
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(textInput);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
        delete canvasStartPositions[cellId];
    });
    
    canvas.addEventListener('pointerout', () => {
        stopDrawing(canvas, cellId);
        delete canvasStartPositions[cellId];
    });
    
    // Clear canvas drawing on double click/tap
    canvas.addEventListener('dblclick', () => {
        clearCanvasCell(cellId);
    });
}

function startDrawing(e, canvas, ctx) {
    isDrawing = true;
    currentCanvas = canvas;
    currentCtx = ctx;
    
    // Support stylus pressure sensitivity if pointerType is pen
    if (e.pointerType === 'pen' && e.pressure) {
        ctx.lineWidth = e.pressure * 6;
    } else {
        ctx.lineWidth = 3;
    }
    
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

function draw(e, canvas, ctx, cellId) {
    if (!isDrawing || currentCanvas !== canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    lastX = x;
    lastY = y;
}

function stopDrawing(canvas, cellId) {
    if (!isDrawing) return;
    isDrawing = false;
    
    // Save state
    const dataUrl = canvas.toDataURL();
    drawingStates[cellId] = dataUrl;
    
    // Mirror drawing to the other canvas if it exists (desktop <=> mobile)
    const prefix = canvas.id.startsWith('mob-') ? '' : 'mob-';
    const oppositeCanvasId = prefix + 'canvas-' + cellId;
    const oppositeCanvas = document.getElementById(oppositeCanvasId);
    if (oppositeCanvas) {
        restoreCanvasData(oppositeCanvas, dataUrl);
    }
}

function restoreCanvasData(canvas, dataUrl) {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = dataUrl;
    img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
}

// SAVE CURRENT 20-ROW WORKSPACE
function saveCurrentTable() {
    const todayStr = getTodayDateStr();
    const cols = ['word', 'pronunciation', 'meaning', 'memorySentence', 'synonyms', 'antonyms'];
    const newWordsList = [];
    
    let wordsSavedCount = 0;
    
    for (let r = 1; r <= 20; r++) {
        // Collect cell items
        const rowData = {
            id: Date.now() + r, // Unique timestamp ID
            language: activeLang,
            date: todayStr,
            createdAt: Date.now()
        };
        
        let hasContent = false;
        
        cols.forEach(col => {
            const cellId = `cell-${r}-${col}`;
            const textInput = document.getElementById(cellId);
            
            // Check if is pen mode or keyboard mode
            const container = document.getElementById(`container-${cellId}`);
            const isPenMode = container.querySelector('.btn-pen').classList.contains('active');
            
            if (isPenMode && drawingStates[cellId]) {
                rowData[col] = { type: 'drawing', data: drawingStates[cellId] };
                hasContent = true;
            } else {
                const text = textInput.innerHTML.trim();
                rowData[col] = { type: 'text', data: text };
                if (text && text !== '...' && text !== '<br>') {
                    hasContent = true;
                }
            }
        });
        
        if (hasContent) {
            // Generate sorting key from 'word' text or default
            let wordText = '';
            if (rowData.word && rowData.word.type === 'text') {
                // Strip tags
                wordText = rowData.word.data.replace(/<[^>]*>/g, '').toLowerCase().trim();
            }
            rowData.wordText = wordText || 'untitled_' + rowData.id;
            
            newWordsList.push(rowData);
            wordsSavedCount++;
        }
    }
    
    if (newWordsList.length === 0) {
        alert("Kaydetmek için en az bir hücre doldurmanız gerekiyor!");
        return;
    }
    
    saveWords(newWordsList, () => {
        // Log words to daily reports
        logReportActivity('wordWritten', wordsSavedCount);
        
        alert("Tablodaki kelimeler başarıyla kaydedildi!");
        
        // Refresh cache
        getWords(() => {
            // Clear current inputs
            clearCurrentTable(true);
            switchScreen('screen-word-lists');
        });
    });
}

function clearCurrentTable(silent = false) {
    if (!silent && !confirm("Tablodaki tüm verileri temizlemek istediğinizden emin misiniz?")) return;
    
    const cols = ['word', 'pronunciation', 'meaning', 'memorySentence', 'synonyms', 'antonyms'];
    
    for (let r = 1; r <= 20; r++) {
        cols.forEach(col => {
            const cellId = `cell-${r}-${col}`;
            document.getElementById(cellId).innerHTML = '';
            document.getElementById(`mob-${cellId}`).innerHTML = '';
            
            // Switch back to keyboard mode
            toggleCellInputMode(cellId, 'kbd');
            clearCanvasCell(cellId);
        });
    }
}

// CHALKBOARD BOARD SYSTEM FUNCTIONS
function clearChalkboard(silent = false) {
    if (!silent && !confirm("Tahtadaki tüm verileri temizlemek istediğinizden emin misiniz?")) return;
    
    const fields = [
        'board-word', 'board-pronunciation', 'board-meaning', 'board-memorySentence',
        'board-synonym-1', 'board-synonym-2', 'board-synonym-3',
        'board-antonym-1', 'board-antonym-2', 'board-antonym-3'
    ];
    
    fields.forEach(fieldId => {
        const textInput = document.getElementById(fieldId);
        if (textInput) {
            textInput.innerHTML = '';
        }
        
        // Switch back to keyboard mode
        toggleCellInputMode(fieldId, 'kbd');
        clearCanvasCell(fieldId);
    });
}

function getCellData(cellId) {
    const container = document.getElementById(`container-${cellId}`);
    const textInput = document.getElementById(cellId);
    
    if (!container || !textInput) return { type: 'text', data: '' };
    
    const btnPen = container.querySelector('.btn-pen');
    const isPenMode = btnPen && btnPen.classList.contains('active');
    
    if (isPenMode && drawingStates[cellId]) {
        return { type: 'drawing', data: drawingStates[cellId] };
    } else {
        const text = textInput.innerHTML.trim();
        return { type: 'text', data: text === '...' ? '' : text };
    }
}

function saveChalkboardWord() {
    const todayStr = getTodayDateStr();
    
    const wordData = getCellData('board-word');
    const meaningData = getCellData('board-meaning');
    const pronunciationData = getCellData('board-pronunciation');
    const memorySentenceData = getCellData('board-memorySentence');
    
    const wordTextClean = wordData.type === 'text' 
        ? wordData.data.replace(/<[^>]*>/g, '').toLowerCase().trim() 
        : '';
        
    const hasWordContent = wordData.type === 'drawing' && drawingStates['board-word'];
    const hasWordText = wordData.type === 'text' && wordData.data.trim() !== '';
    const hasMeaningContent = meaningData.type === 'drawing' && drawingStates['board-meaning'];
    const hasMeaningText = meaningData.type === 'text' && meaningData.data.trim() !== '';
    
    if (!(hasWordContent || hasWordText) && !(hasMeaningContent || hasMeaningText)) {
        alert("Kaydetmek için en azından Kelime veya Anlamı alanını doldurmanız gerekiyor!");
        return;
    }
    
    const synonymsList = [
        getCellData('board-synonym-1'),
        getCellData('board-synonym-2'),
        getCellData('board-synonym-3')
    ];
    
    const antonymsList = [
        getCellData('board-antonym-1'),
        getCellData('board-antonym-2'),
        getCellData('board-antonym-3')
    ];
    
    const rowId = Date.now();
    const wordObj = {
        id: rowId,
        language: activeLang,
        date: todayStr,
        createdAt: Date.now(),
        word: wordData,
        pronunciation: pronunciationData,
        meaning: meaningData,
        memorySentence: memorySentenceData,
        synonyms: synonymsList,
        antonyms: antonymsList,
        wordText: wordTextClean || 'untitled_' + rowId
    };
    
    saveWords([wordObj], () => {
        logReportActivity('wordWritten', 1);
        alert("Kelime başarıyla kaydedildi!");
        clearChalkboard(true);
        
        getWords(() => {
            loadAlphabeticalList();
            loadArchiveList();
            switchScreen('screen-word-lists');
        });
    });
}

function initChalkboardKeyboardBindings() {
    const fields = [
        'board-word', 'board-pronunciation', 'board-meaning', 'board-memorySentence',
        'board-synonym-1', 'board-synonym-2', 'board-synonym-3',
        'board-antonym-1', 'board-antonym-2', 'board-antonym-3'
    ];
    
    fields.forEach(fieldId => {
        const inputEl = document.getElementById(fieldId);
        if (inputEl) {
            inputEl.addEventListener('focus', () => {
                activeFocusedInput = inputEl;
                openVirtualKeyboardForLang();
            });
            
            // Clear drawing when Backspace is pressed and text field is already empty
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && inputEl.innerText.trim() === '') {
                    clearCanvasCell(fieldId);
                }
            });
        }
    });
}

function initChalkboardCanvases() {
    const fields = [
        'board-word', 'board-pronunciation', 'board-meaning', 'board-memorySentence',
        'board-synonym-1', 'board-synonym-2', 'board-synonym-3',
        'board-antonym-1', 'board-antonym-2', 'board-antonym-3'
    ];
    
    fields.forEach(fieldId => {
        const canvas = document.getElementById(`canvas-${fieldId}`);
        if (canvas) {
            setupCanvas(canvas, fieldId);
        }
    });
}

// SELECTION & RICH TEXT COLOR TOOL
let highlightColor = localStorage.getItem('highlightColor') || '#ff3b30';

function setHighlightColor(color) {
    highlightColor = color;
    localStorage.setItem('highlightColor', color);
    
    // Sync class 'active' on Settings highlight bubbles
    document.querySelectorAll('.highlight-color-bubble').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Map to specific button classes
    let targetClass = 'btn-color-default';
    if (color === '#ff3b30') targetClass = 'btn-color-red';
    else if (color === '#34c759') targetClass = 'btn-color-green';
    else if (color === '#007aff') targetClass = 'btn-color-blue';
    else if (color === '#ffcc00') targetClass = 'btn-color-yellow';
    else if (color === '#af52de') targetClass = 'btn-color-purple';
    else if (color === '#ff9500') targetClass = 'btn-color-orange';
    
    const activeBtn = document.querySelector(`.highlight-color-bubble.${targetClass}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

function initSelectionColorListener() {
    const tooltip = document.getElementById('text-highlight-tooltip');
    
    document.addEventListener('selectionchange', () => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const text = range.toString().trim();
            
            // Ensure selection is inside one of our contenteditable cells
            let parent = range.commonAncestorContainer;
            if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
            
            const isInsideInput = parent.closest('.text-input') !== null;
            
            if (text.length > 0 && isInsideInput) {
                selectedRange = range.cloneRange();
                
                // Position the tooltip above the selected text
                const rect = range.getBoundingClientRect();
                if (tooltip) {
                    tooltip.classList.remove('hidden');
                    tooltip.style.top = `${rect.top + window.scrollY - 50}px`;
                    tooltip.style.left = `${rect.left + window.scrollX + (rect.width/2) - (tooltip.offsetWidth/2)}px`;
                }
                return;
            }
        }
        
        // Hide tooltip if no selection
        if (tooltip && !tooltip.classList.contains('hidden')) {
            setTimeout(() => {
                const sel = window.getSelection().toString().trim();
                if (sel.length === 0) hideColorPicker();
            }, 100);
        }
    });
}

function hideColorPicker() {
    const tooltip = document.getElementById('text-highlight-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
    window.getSelection().removeAllRanges(); // Clear selection range to prevent selectionchange re-triggering
    selectedRange = null;
}

function applyHighlightColor(color) {
    const targetColor = (color === undefined) ? highlightColor : color;
    if (!selectedRange) return;
    
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(selectedRange);
    
    // Apply styling
    document.execCommand('styleWithCSS', false, true);
    const fallbackColor = chalkboardMode ? '#f0f3f1' : '#2c3e50';
    document.execCommand('foreColor', false, targetColor || fallbackColor);
    
    // Sync contents between mobile and desktop inputs
    let parentInput = selectedRange.commonAncestorContainer;
    if (parentInput.nodeType === Node.TEXT_NODE) parentInput = parentInput.parentNode;
    parentInput = parentInput.closest('.text-input');
    
    if (parentInput) {
        const isMob = parentInput.id.startsWith('mob-');
        const counterpartId = isMob ? parentInput.id.substring(4) : `mob-${parentInput.id}`;
        const counterpart = document.getElementById(counterpartId);
        if (counterpart) {
            counterpart.innerHTML = parentInput.innerHTML;
        }
    }
    
    hideColorPicker();
    selection.removeAllRanges();
    selectedRange = null;
}

// VIRTUAL KEYBOARDS FOR MULTIPLE LANGUAGES (WITH ADDED DELETE KEY)
const KEYBOARD_LAYOUTS = {
    english: [
        'q','w','e','r','t','y','u','i','o','p',
        'a','s','d','f','g','h','j','k','l',
        'z','x','c','v','b','n','m','Space','Backspace','Delete'
    ],
    german: [
        'q','w','e','r','t','z','u','i','o','p','ü',
        'a','s','d','f','g','h','j','k','l','ä','ö',
        'y','x','c','v','b','n','m','ß',
        'Space','Backspace','Delete'
    ],
    french: [
        'a','z','e','r','t','y','u','i','o','p',
        'q','s','d','f','g','h','j','k','l','m',
        'w','x','c','v','b','n','é','è','à','ç','ù',
        'â','ê','î','ô','û','ë','ï','ü','œ','æ',
        'Space','Backspace','Delete'
    ],
    italian: [
        'q','w','e','r','t','y','u','i','o','p',
        'a','s','d','f','g','h','j','k','l',
        'z','x','c','v','b','n','m','à','è','é','ì','ò','ù',
        'Space','Backspace','Delete'
    ],
    japanese: [
        // Hiragana basics
        'あ','い','う','え','お',  'か','き','く','け','こ',
        'さ','し','す','せ','そ',  'た','ち','つ','て','と',
        'な','ni','ぬ','ね','の',  'は','ひ','ふ','へ','ほ',
        'ま','み','む','め','も',  'や','ゆ','よ',
        'ら','り','る','れ','ろ',  'わ','を','ん',
        // Common Katakana basics
        'ア','イ','ウ','エ','オ',  'カ','キ','ク','ケ','コ',
        'サ','シ','ス','セ','ソ',  'タ','チ','ツ','て','ト',
        'Space','Backspace','Delete'
    ],
    hebrew: [
        'ק','ר','א','ט','ו','ן','ם','פ',
        'ש','ד','ג','כ','ע','י','ח','ל','ך','ף',
        'ז','ס','ב','ה','נ','מ','צ','ת','ץ','ך',
        'Space','Backspace','Delete'
    ]
};

function openVirtualKeyboardForLang() {
    const layout = KEYBOARD_LAYOUTS[activeLang] || KEYBOARD_LAYOUTS.english;
    const container = document.getElementById('keyboard-keys-container');
    const label = document.getElementById('keyboard-lang-label');
    
    label.textContent = `Sanal Klavye (${activeLangName})`;
    container.innerHTML = '';
    
    layout.forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'kb-key';
        
        if (key === 'Space') {
            btn.textContent = 'Boşluk';
            btn.style.flexGrow = '2';
        } else if (key === 'Backspace') {
            btn.textContent = '⌫ Geri';
            btn.style.backgroundColor = '#ff3b30';
            btn.style.color = '#ffffff';
        } else if (key === 'Delete') {
            btn.textContent = '⌦ Sil';
            btn.style.backgroundColor = '#ff9500';
            btn.style.color = '#ffffff';
        } else {
            btn.textContent = key;
        }
        
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevents losing focus on inputs
            handleVirtualKeyPress(key);
        });
        
        container.appendChild(btn);
    });
    
    toggleVirtualKeyboard(true);
}

function toggleVirtualKeyboard(show) {
    const kbd = document.getElementById('virtual-keyboard-drawer');
    if (show) {
        kbd.classList.remove('hidden');
    } else {
        kbd.classList.add('hidden');
        if (activeFocusedInput) {
            activeFocusedInput.blur(); // Blur active input to prevent refocus triggers
            activeFocusedInput = null;
        }
    }
}

function handleVirtualKeyPress(key) {
    if (!activeFocusedInput) return;
    activeFocusedInput.focus();
    
    const selection = window.getSelection();
    
    if (key === 'Backspace') {
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
        } else {
            // Delete one character at cursor
            const range = selection.getRangeAt(0);
            if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
                range.setStart(range.startContainer, range.startOffset - 1);
                range.deleteContents();
            } else {
                // Fallback character deletion
                const text = activeFocusedInput.innerHTML;
                if (text.endsWith(';')) {
                    activeFocusedInput.innerHTML = text.substring(0, text.lastIndexOf('&'));
                } else if (text.endsWith('>')) {
                    activeFocusedInput.innerHTML = text.substring(0, text.lastIndexOf('<'));
                } else {
                    activeFocusedInput.innerHTML = text.substring(0, text.length - 1);
                }
            }
        }
    } else if (key === 'Delete') {
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
        } else {
            // Delete key clears the entire field text and erases pen drawing
            activeFocusedInput.innerHTML = '';
            clearCanvasCell(activeFocusedInput.id);
        }
    } else if (key === 'Space') {
        document.execCommand('insertText', false, ' ');
    } else {
        document.execCommand('insertText', false, key);
    }
    
    // Sync clones
    const isMob = activeFocusedInput.id.startsWith('mob-');
    const counterpartId = isMob ? activeFocusedInput.id.substring(4) : `mob-${activeFocusedInput.id}`;
    const counterpart = document.getElementById(counterpartId);
    if (counterpart) {
        counterpart.innerHTML = activeFocusedInput.innerHTML;
    }
}

// ALPHABETICAL WORD LIST RENDERER
function loadAlphabeticalList() {
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        
        // Sort alphabetically
        langWords.sort((a, b) => a.wordText.localeCompare(b.wordText));
        
        document.getElementById('total-words-count').textContent = langWords.length;
        
        const grid = document.getElementById('alphabetical-words-grid');
        const placeholder = document.getElementById('no-words-placeholder');
        
        if (langWords.length === 0) {
            grid.classList.add('hidden');
            placeholder.classList.remove('hidden');
            return;
        }
        
        placeholder.classList.add('hidden');
        grid.classList.remove('hidden');
        renderWordCards(langWords, grid);
        
        // Generate letters filter
        generateAlphabetNav(langWords);
    });
}

function renderWordCards(wordsList, containerElement) {
    containerElement.innerHTML = '';
    
    wordsList.forEach(w => {
        const card = document.createElement('div');
        card.className = 'word-display-card collapsed';
        card.id = `card-word-${w.id}`;
        
        // Header
        const header = document.createElement('div');
        header.className = 'card-header-row';
        
        const titleSpan = document.createElement('div');
        titleSpan.className = 'card-word-title';
        renderCellContent(w.word, titleSpan);
        
        const headerRight = document.createElement('div');
        headerRight.className = 'card-header-right';
        headerRight.style.display = 'flex';
        headerRight.style.alignItems = 'center';
        headerRight.style.gap = '8px';
        
        const chevron = document.createElement('span');
        chevron.className = 'expand-chevron';
        chevron.innerHTML = '▼';
        
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-delete-word';
        btnDel.innerHTML = '🗑️';
        btnDel.title = 'Kelimeyi Sil';
        btnDel.onclick = (e) => {
            e.stopPropagation(); // Stop click from bubbling to card expansion
            if (confirm("Bu kelimeyi silmek istediğinizden emin misiniz?")) {
                deleteWord(w.id, () => {
                    loadAlphabeticalList();
                    loadArchiveList();
                });
            }
        };
        
        headerRight.appendChild(chevron);
        headerRight.appendChild(btnDel);
        header.appendChild(titleSpan);
        header.appendChild(headerRight);
        card.appendChild(header);
        
        // Details container
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'card-details-container';
        
        // VIEW MODE CONTAINER
        const viewModeDiv = document.createElement('div');
        viewModeDiv.className = 'card-view-mode';
        
        const fields = [
            { key: 'pronunciation', label: 'Okunuşu' },
            { key: 'meaning', label: 'Anlamı' },
            { key: 'memorySentence', label: 'Hafıza Cümlesi' },
            { key: 'synonyms', label: 'Eş Anlam' },
            { key: 'antonyms', label: 'Zıt Anlam' }
        ];
        
        fields.forEach(field => {
            const val = w[field.key];
            if (val) {
                const fDiv = document.createElement('div');
                fDiv.className = 'card-field';
                fDiv.innerHTML = `<span class="card-label">${field.label}:</span> `;
                
                const spanVal = document.createElement('span');
                spanVal.className = 'card-value';
                
                if (Array.isArray(val)) {
                    // Render list
                    let hasAny = false;
                    val.forEach(item => {
                        const hasVal = item && (item.type === 'drawing' ? item.data : (item.data && item.data !== '...' && item.data !== '<br>' && item.data.trim() !== ''));
                        if (hasVal) {
                            if (hasAny) {
                                const comma = document.createElement('span');
                                comma.innerHTML = ', ';
                                spanVal.appendChild(comma);
                            }
                            const itemSpan = document.createElement('span');
                            renderCellContent(item, itemSpan);
                            spanVal.appendChild(itemSpan);
                            hasAny = true;
                        }
                    });
                    if (!hasAny) {
                        spanVal.innerHTML = '-';
                    }
                } else {
                    // Render single cell legacy object
                    renderCellContent(val, spanVal);
                }
                fDiv.appendChild(spanVal);
                viewModeDiv.appendChild(fDiv);
            }
        });
        
        // Date stamp and Edit Button row inside View Mode
        const footerRow = document.createElement('div');
        footerRow.className = 'card-footer-row';
        
        const dateStamp = document.createElement('div');
        dateStamp.className = 'date-stamp';
        dateStamp.textContent = w.date || 'Tarihsiz';
        
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-edit-word';
        btnEdit.innerHTML = '✏️ Düzenle';
        btnEdit.onclick = (e) => {
            e.stopPropagation();
            viewModeDiv.classList.add('hidden');
            editModeDiv.classList.remove('hidden');
        };
        
        footerRow.appendChild(dateStamp);
        footerRow.appendChild(btnEdit);
        viewModeDiv.appendChild(footerRow);
        
        // EDIT MODE CONTAINER
        const editModeDiv = document.createElement('div');
        editModeDiv.className = 'card-edit-mode hidden';
        
        // Form field helper functions
        const getCellText = (cellObj) => {
            if (!cellObj) return '';
            return cellObj.type === 'text' ? (cellObj.data || '') : '';
        };
        
        const updateCellFromInput = (oldCell, newText) => {
            if (newText.trim() === '') {
                if (oldCell && oldCell.type === 'drawing') {
                    return oldCell; // Keep drawing if text is empty and drawing exists
                }
                return { type: 'text', data: '' };
            }
            return { type: 'text', data: newText };
        };
        
        // Form Field: Word
        const formFieldWord = document.createElement('div');
        formFieldWord.className = 'edit-form-field';
        formFieldWord.innerHTML = '<label class="edit-field-label">Kelime (Word):</label>';
        const inputWord = document.createElement('input');
        inputWord.type = 'text';
        inputWord.className = 'card-edit-input';
        inputWord.value = getCellText(w.word);
        formFieldWord.appendChild(inputWord);
        editModeDiv.appendChild(formFieldWord);
        
        // Form Field: Pronunciation
        const formFieldPron = document.createElement('div');
        formFieldPron.className = 'edit-form-field';
        formFieldPron.innerHTML = '<label class="edit-field-label">Türkçe Okunuşu:</label>';
        const inputPron = document.createElement('input');
        inputPron.type = 'text';
        inputPron.className = 'card-edit-input';
        inputPron.value = getCellText(w.pronunciation);
        formFieldPron.appendChild(inputPron);
        editModeDiv.appendChild(formFieldPron);
        
        // Form Field: Meaning
        const formFieldMeaning = document.createElement('div');
        formFieldMeaning.className = 'edit-form-field';
        formFieldMeaning.innerHTML = '<label class="edit-field-label">Türkçe Anlamı:</label>';
        const inputMeaning = document.createElement('input');
        inputMeaning.type = 'text';
        inputMeaning.className = 'card-edit-input';
        inputMeaning.value = getCellText(w.meaning);
        formFieldMeaning.appendChild(inputMeaning);
        editModeDiv.appendChild(formFieldMeaning);
        
        // Form Field: Memory Sentence
        const formFieldMem = document.createElement('div');
        formFieldMem.className = 'edit-form-field';
        formFieldMem.innerHTML = '<label class="edit-field-label">Hafıza Cümlesi:</label>';
        const textareaMem = document.createElement('textarea');
        textareaMem.className = 'card-edit-textarea';
        textareaMem.value = getCellText(w.memorySentence);
        formFieldMem.appendChild(textareaMem);
        editModeDiv.appendChild(formFieldMem);
        
        // Form Field: Synonyms
        const formFieldSyn = document.createElement('div');
        formFieldSyn.className = 'edit-form-field';
        formFieldSyn.innerHTML = '<label class="edit-field-label">Eş Anlamlıları:</label>';
        let inputSyns = [];
        if (Array.isArray(w.synonyms)) {
            const containerSyns = document.createElement('div');
            containerSyns.className = 'edit-subfields-container';
            for (let i = 0; i < 3; i++) {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'card-edit-input sub-input';
                inp.placeholder = `Eş anlam ${i+1}`;
                inp.value = getCellText(w.synonyms[i]);
                containerSyns.appendChild(inp);
                inputSyns.push(inp);
            }
            formFieldSyn.appendChild(containerSyns);
        } else {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'card-edit-input';
            inp.value = getCellText(w.synonyms);
            formFieldSyn.appendChild(inp);
            inputSyns.push(inp);
        }
        editModeDiv.appendChild(formFieldSyn);
        
        // Form Field: Antonyms
        const formFieldAnt = document.createElement('div');
        formFieldAnt.className = 'edit-form-field';
        formFieldAnt.innerHTML = '<label class="edit-field-label">Zıt Anlamlıları:</label>';
        let inputAnts = [];
        if (Array.isArray(w.antonyms)) {
            const containerAnts = document.createElement('div');
            containerAnts.className = 'edit-subfields-container';
            for (let i = 0; i < 3; i++) {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'card-edit-input sub-input';
                inp.placeholder = `Zıt anlam ${i+1}`;
                inp.value = getCellText(w.antonyms[i]);
                containerAnts.appendChild(inp);
                inputAnts.push(inp);
            }
            formFieldAnt.appendChild(containerAnts);
        } else {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'card-edit-input';
            inp.value = getCellText(w.antonyms);
            formFieldAnt.appendChild(inp);
            inputAnts.push(inp);
        }
        editModeDiv.appendChild(formFieldAnt);
        
        // Actions inside editModeDiv
        const editActionsRow = document.createElement('div');
        editActionsRow.className = 'card-actions-row';
        
        const btnSave = document.createElement('button');
        btnSave.className = 'btn-save-edit';
        btnSave.innerHTML = '💾 Kaydet';
        btnSave.onclick = (e) => {
            e.stopPropagation();
            
            // Perform Database Save
            const newWord = updateCellFromInput(w.word, inputWord.value);
            const newPron = updateCellFromInput(w.pronunciation, inputPron.value);
            const newMeaning = updateCellFromInput(w.meaning, inputMeaning.value);
            const newMem = updateCellFromInput(w.memorySentence, textareaMem.value);
            
            let newSyns;
            if (Array.isArray(w.synonyms)) {
                newSyns = inputSyns.map((inp, idx) => updateCellFromInput(w.synonyms[idx], inp.value));
            } else {
                newSyns = updateCellFromInput(w.synonyms, inputSyns[0].value);
            }
            
            let newAnts;
            if (Array.isArray(w.antonyms)) {
                newAnts = inputAnts.map((inp, idx) => updateCellFromInput(w.antonyms[idx], inp.value));
            } else {
                newAnts = updateCellFromInput(w.antonyms, inputAnts[0].value);
            }
            
            // Build updated object
            const updatedObj = {
                ...w,
                word: newWord,
                pronunciation: newPron,
                meaning: newMeaning,
                memorySentence: newMem,
                synonyms: newSyns,
                antonyms: newAnts,
                wordText: (newWord.type === 'text' && newWord.data ? newWord.data.trim() : w.wordText)
            };
            
            saveWords([updatedObj], () => {
                // Reload lists
                getWords(() => {
                    loadAlphabeticalList();
                    loadArchiveList();
                });
            });
        };
        
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-cancel-edit';
        btnCancel.innerHTML = '❌ İptal';
        btnCancel.onclick = (e) => {
            e.stopPropagation();
            // Reset fields
            inputWord.value = getCellText(w.word);
            inputPron.value = getCellText(w.pronunciation);
            inputMeaning.value = getCellText(w.meaning);
            textareaMem.value = getCellText(w.memorySentence);
            if (Array.isArray(w.synonyms)) {
                inputSyns.forEach((inp, idx) => inp.value = getCellText(w.synonyms[idx]));
            } else {
                inputSyns[0].value = getCellText(w.synonyms);
            }
            if (Array.isArray(w.antonyms)) {
                inputAnts.forEach((inp, idx) => inp.value = getCellText(w.antonyms[idx]));
            } else {
                inputAnts[0].value = getCellText(w.antonyms);
            }
            
            // Toggle view
            editModeDiv.classList.add('hidden');
            viewModeDiv.classList.remove('hidden');
        };
        
        editActionsRow.appendChild(btnSave);
        editActionsRow.appendChild(btnCancel);
        editModeDiv.appendChild(editActionsRow);
        
        detailsDiv.appendChild(viewModeDiv);
        detailsDiv.appendChild(editModeDiv);
        
        card.appendChild(detailsDiv);
        
        // Toggle expansion on card click (excluding inputs/actions)
        card.onclick = (e) => {
            if (e.target.closest('.btn-delete-word') || 
                e.target.closest('.card-edit-mode') || 
                e.target.closest('.card-actions-row') || 
                e.target.closest('input') || 
                e.target.closest('textarea') || 
                e.target.closest('button')) {
                return;
            }
            
            const isCollapsed = card.classList.contains('collapsed');
            if (isCollapsed) {
                card.classList.remove('collapsed');
                card.classList.add('expanded');
            } else {
                card.classList.remove('expanded');
                card.classList.add('collapsed');
            }
        };
        
        containerElement.appendChild(card);
    });
}

function renderCellContent(cellObj, targetSpan) {
    if (!cellObj) return;
    if (cellObj.type === 'drawing') {
        const img = document.createElement('img');
        img.src = cellObj.data;
        img.className = 'card-image-display';
        targetSpan.appendChild(img);
    } else {
        targetSpan.innerHTML = cellObj.data || '...';
    }
}

function generateAlphabetNav(wordsList) {
    const nav = document.getElementById('alphabet-nav');
    nav.innerHTML = '';
    
    // Get unique first letters
    const letters = new Set();
    wordsList.forEach(w => {
        if (w.wordText) {
            letters.add(w.wordText.charAt(0).toUpperCase());
        }
    });
    
    const sortedLetters = Array.from(letters).sort();
    
    // Add "All" button
    const btnAll = document.createElement('button');
    btnAll.className = 'letter-btn active';
    btnAll.textContent = 'HEPSİ';
    btnAll.onclick = () => {
        document.querySelectorAll('.letter-btn').forEach(b => b.classList.remove('active'));
        btnAll.classList.add('active');
        renderWordCards(wordsList, document.getElementById('alphabetical-words-grid'));
    };
    nav.appendChild(btnAll);
    
    sortedLetters.forEach(let => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = let;
        btn.onclick = () => {
            document.querySelectorAll('.letter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const filtered = wordsList.filter(w => w.wordText && w.wordText.charAt(0).toUpperCase() === let);
            renderWordCards(filtered, document.getElementById('alphabetical-words-grid'));
        };
        nav.appendChild(btn);
    });
}

function filterAlphabeticalList() {
    const query = document.getElementById('search-words-input').value.toLowerCase().trim();
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        langWords.sort((a, b) => a.wordText.localeCompare(b.wordText));
        
        const filtered = langWords.filter(w => {
            // Match plain text values
            const word = w.wordText || '';
            const meaning = w.meaning && w.meaning.type === 'text' ? w.meaning.data.toLowerCase() : '';
            return word.includes(query) || meaning.includes(query);
        });
        
        renderWordCards(filtered, document.getElementById('alphabetical-words-grid'));
    });
}

// HISTORICAL ARCHIVE ENGINE
function loadArchiveList() {
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        
        // Group by Date
        const groups = {};
        langWords.forEach(w => {
            const date = w.date || 'Tarihsiz';
            if (!groups[date]) groups[date] = [];
            groups[date].push(w);
        });
        
        const dateList = document.getElementById('archive-date-list');
        dateList.innerHTML = '';
        
        const dates = Object.keys(groups).sort((a, b) => {
            // Sort DD.MM.YYYY dates descending
            const partsA = a.split('.');
            const partsB = b.split('.');
            if (partsA.length === 3 && partsB.length === 3) {
                const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
                const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
                return dateB - dateA;
            }
            return b.localeCompare(a);
        });
        
        if (dates.length === 0) {
            dateList.innerHTML = `<li style="padding: 10px; color: var(--text-light)">Kayıt yok.</li>`;
            document.getElementById('archive-selected-date-title').textContent = 'Kayıtlı arşiv bulunamadı';
            document.getElementById('archive-words-grid').classList.add('hidden');
            document.getElementById('archive-words-placeholder').classList.remove('hidden');
            return;
        }
        
        dates.forEach(date => {
            const li = document.createElement('li');
            li.className = 'date-item';
            li.innerHTML = `<span>${date}</span> <span class="badge" style="background: var(--primary-color); color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem">${groups[date].length} Kelime</span>`;
            
            li.onclick = () => {
                document.querySelectorAll('.date-item').forEach(i => i.classList.remove('active'));
                li.classList.add('active');
                
                document.getElementById('archive-selected-date-title').textContent = `${date} Tarihli Kelimeler (${groups[date].length} Kelime)`;
                document.getElementById('archive-words-placeholder').classList.add('hidden');
                
                const grid = document.getElementById('archive-words-grid');
                grid.classList.remove('hidden');
                
                renderWordCards(groups[date], grid);
            };
            
            dateList.appendChild(li);
        });
    });
}

// TEST & GAMES SYSTEM
function checkTestLockStatus() {
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        const fiveOptionsCard = document.getElementById('five-options-card');
        
        if (langWords.length >= 50) {
            fiveOptionsCard.style.opacity = '1';
            fiveOptionsCard.style.cursor = 'pointer';
            fiveOptionsCard.querySelector('.lock-hint').textContent = `🔓 Sınav Aktif (${langWords.length} Kelime)`;
            fiveOptionsCard.querySelector('.lock-hint').style.color = 'var(--success-color)';
        } else {
            fiveOptionsCard.style.opacity = '0.5';
            fiveOptionsCard.style.cursor = 'not-allowed';
            fiveOptionsCard.querySelector('.lock-hint').textContent = `🔒 Arşivde en az 50 kelime olmalıdır (Şu an: ${langWords.length})`;
            fiveOptionsCard.querySelector('.lock-hint').style.color = 'var(--danger-color)';
        }
    });
}

function initGame(gameType) {
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        
        if (langWords.length < 5) {
            alert("Oyunları başlatmak için en az 5 kelime kaydetmelisiniz!");
            return;
        }
        
        if (gameType === 'five-options' && langWords.length < 50) {
            alert("5 Şıklı Sınav için arşivde en az 50 kelime olmalıdır!");
            return;
        }
        
        currentGameType = gameType;
        gameScore = 0;
        document.getElementById('game-score').textContent = '0';
        
        switchScreen('screen-playground');
        
        // Setup specific game boards
        setupGameBoard(langWords);
    });
}

function setupGameBoard(wordsList) {
    const playground = document.getElementById('playground-body');
    playground.innerHTML = '';
    
    // Clear timers
    if (timedTimerId) clearInterval(timedTimerId);
    if (memoryTimerId) clearTimeout(memoryTimerId);
    
    if (currentGameType === 'hangman') {
        document.getElementById('playground-title').textContent = 'Adam Asmaca';
        setupHangmanBoard(wordsList);
    } else if (currentGameType === 'matching') {
        document.getElementById('playground-title').textContent = 'Kelime Eşleştirme';
        setupMatchingBoard(wordsList);
    } else if (currentGameType === 'en-tr' || currentGameType === 'tr-en') {
        document.getElementById('playground-title').textContent = currentGameType === 'en-tr' ? 'Hedef Dil ➔ TR Test' : 'TR ➔ Hedef Dil Test';
        setupMultipleChoiceBoard(wordsList, 4);
    } else if (currentGameType === 'five-options') {
        document.getElementById('playground-title').textContent = '5 Şıklı Çoktan Seçmeli Test';
        // Randomly pick direction
        const dir = Math.random() > 0.5 ? 'en-tr' : 'tr-en';
        setupMultipleChoiceBoard(wordsList, 5, dir);
    } else if (currentGameType === 'timed') {
        document.getElementById('playground-title').textContent = 'Zaman Ayarlı Kelime Testi';
        setupTimedBoard(wordsList);
    } else if (currentGameType === 'memory') {
        document.getElementById('playground-title').textContent = 'Hafızaya Alma (Smart Recall)';
        setupMemoryBoard(wordsList);
    }
}

// 1. ADAM ASMACA
function setupHangmanBoard(wordsList) {
    // Select a word that is text-based in both word and meaning
    const filtered = wordsList.filter(w => w.word.type === 'text' && w.meaning.type === 'text');
    if (filtered.length === 0) {
        document.getElementById('playground-body').innerHTML = '<div class="placeholder-msg">Lütfen adam asmaca oynamak için elle yazılmış kelimeler ekleyin (Çizim kelimeler desteklenmez).</div>';
        return;
    }
    
    hangmanWord = filtered[Math.floor(Math.random() * filtered.length)];
    
    // Reset status
    hangmanGuesses = [];
    hangmanLives = 6;
    
    const wordClean = getCleanText(hangmanWord.word.data).toUpperCase();
    const meaningClean = getCleanText(hangmanWord.meaning.data);
    const memorySentence = hangmanWord.memorySentence && hangmanWord.memorySentence.type === 'text' ? getCleanText(hangmanWord.memorySentence.data) : '';
    
    const box = document.createElement('div');
    box.className = 'game-box';
    box.innerHTML = `
        <div class="hangman-layout">
            <canvas id="hangman-canvas" width="180" height="200" class="hangman-canvas"></canvas>
            <div class="clue-box">
                <strong>İpucu (Anlamı):</strong> ${meaningClean}<br>
                ${memorySentence ? `<strong>Hafıza Cümlesi:</strong> ${memorySentence}` : ''}
            </div>
            <div class="hangman-word-display" id="hangman-word-slots"></div>
            <div class="hangman-keys" id="hangman-keyboard"></div>
            <div id="hangman-status-msg" style="font-weight: bold; font-size: 1.2rem; min-height: 30px;"></div>
        </div>
    `;
    document.getElementById('playground-body').appendChild(box);
    
    drawHangmanGallows();
    renderHangmanSlots(wordClean);
    renderHangmanKeyboard(wordClean, wordsList);
}

function getCleanText(htmlStr) {
    return htmlStr.replace(/<[^>]*>/g, '').trim();
}

function drawHangmanGallows() {
    const canvas = document.getElementById('hangman-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = chalkboardMode ? '#ffffff' : '#2c3e50';
    ctx.lineWidth = 4;
    
    // Base gallows
    ctx.beginPath();
    ctx.moveTo(20, 180);
    ctx.lineTo(160, 180);
    ctx.moveTo(50, 180);
    ctx.lineTo(50, 20);
    ctx.lineTo(120, 20);
    ctx.lineTo(120, 40);
    ctx.stroke();
}

function drawHangmanStep() {
    const canvas = document.getElementById('hangman-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.strokeStyle = chalkboardMode ? '#ff3b30' : '#ff3b30'; // Red color for body steps
    ctx.lineWidth = 3;
    
    const steps = [
        () => { // 1. Head
            ctx.beginPath();
            ctx.arc(120, 55, 15, 0, Math.PI * 2);
            ctx.stroke();
        },
        () => { // 2. Torso
            ctx.beginPath();
            ctx.moveTo(120, 70);
            ctx.lineTo(120, 120);
            ctx.stroke();
        },
        () => { // 3. Left Arm
            ctx.beginPath();
            ctx.moveTo(120, 85);
            ctx.lineTo(100, 105);
            ctx.stroke();
        },
        () => { // 4. Right Arm
            ctx.beginPath();
            ctx.moveTo(120, 85);
            ctx.lineTo(140, 105);
            ctx.stroke();
        },
        () => { // 5. Left Leg
            ctx.beginPath();
            ctx.moveTo(120, 120);
            ctx.lineTo(100, 150);
            ctx.stroke();
        },
        () => { // 6. Right Leg
            ctx.beginPath();
            ctx.moveTo(120, 120);
            ctx.lineTo(140, 150);
            ctx.stroke();
        }
    ];
    
    const stepIdx = 6 - hangmanLives;
    if (stepIdx > 0 && stepIdx <= 6) {
        steps[stepIdx - 1]();
    }
}

function renderHangmanSlots(wordClean) {
    const slotContainer = document.getElementById('hangman-word-slots');
    let display = '';
    
    for (let char of wordClean) {
        if (char === ' ' || char === '-') {
            display += ' ';
        } else if (hangmanGuesses.includes(char)) {
            display += char;
        } else {
            display += '_';
        }
    }
    
    slotContainer.textContent = display;
    
    // Check win condition
    if (!display.includes('_')) {
        gameScore += 10;
        document.getElementById('game-score').textContent = gameScore;
        document.getElementById('hangman-status-msg').textContent = "🎉 Tebrikler! Kelimeyi Buldunuz.";
        document.getElementById('hangman-status-msg').style.color = "var(--success-color)";
        disableHangmanKeyboard();
        
        logReportActivity('testResult', 'correct');
        
        setTimeout(() => setupGameBoard(wordsDatabase.filter(w => w.language === activeLang)), 2500);
    }
}

function renderHangmanKeyboard(wordClean, wordsList) {
    const container = document.getElementById('hangman-keyboard');
    
    // Use latin alphabet, plus language special letters
    let letters = "ABCÇDEFGHIİJKLMNOÖPRSŞTUÜVYZ".split('');
    
    if (activeLang === 'german') {
        letters.push('Ä', 'Ö', 'Ü', 'ß');
    } else if (activeLang === 'french') {
        letters.push('É', 'È', 'À', 'Ç', 'Ù', 'Œ', 'Æ');
    } else if (activeLang === 'hebrew') {
        // Hebrew letters
        letters = "אבגדהוזחטיכלמנסעפצקרשת".split('');
    } else if (activeLang === 'japanese') {
        // Since Japanese letters are Hiragana/Katakana syllables, we guess Romaji letters
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
    }
    
    letters.forEach(let => {
        const btn = document.createElement('button');
        btn.className = 'hm-key';
        btn.textContent = let;
        
        btn.onclick = () => {
            if (hangmanGuesses.includes(let) || hangmanLives <= 0) return;
            
            btn.classList.add('used');
            btn.disabled = true;
            hangmanGuesses.push(let);
            
            if (wordClean.includes(let)) {
                renderHangmanSlots(wordClean);
            } else {
                hangmanLives--;
                drawHangmanStep();
                
                if (hangmanLives <= 0) {
                    document.getElementById('hangman-status-msg').textContent = `💀 Kaybettiniz! Doğru Kelime: ${wordClean}`;
                    document.getElementById('hangman-status-msg').style.color = "var(--danger-color)";
                    disableHangmanKeyboard();
                    
                    logReportActivity('testResult', 'incorrect');
                    
                    setTimeout(() => setupGameBoard(wordsList), 3500);
                }
            }
        };
        
        container.appendChild(btn);
    });
}

function disableHangmanKeyboard() {
    document.querySelectorAll('.hm-key').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('used');
    });
}

// 2. KELİME EŞLEŞTİRME
function setupMatchingBoard(wordsList) {
    // Pick 4 words
    const shuffled = [...wordsList].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(wordsList.length, 4));
    
    matchingPairs = [];
    selected.forEach(w => {
        matchingPairs.push({ id: w.id, data: w.word, type: 'word' });
        matchingPairs.push({ id: w.id, data: w.meaning, type: 'meaning' });
    });
    
    // Shuffle the matching pairs
    matchingPairs.sort(() => 0.5 - Math.random());
    
    const box = document.createElement('div');
    box.className = 'game-box';
    box.innerHTML = `
        <div class="matching-grid" id="matching-grid-container"></div>
        <div id="matching-status-msg" style="font-weight: bold; font-size: 1.2rem; min-height: 30px; margin-top: 15px;"></div>
    `;
    document.getElementById('playground-body').appendChild(box);
    
    const grid = document.getElementById('matching-grid-container');
    
    matchingPairs.forEach((pair, index) => {
        const item = document.createElement('div');
        item.className = 'match-card';
        item.id = `match-card-${index}`;
        
        renderCellContent(pair.data, item);
        
        item.onclick = () => {
            handleMatchingClick(index, item);
        };
        
        grid.appendChild(item);
    });
}

function handleMatchingClick(index, el) {
    if (el.classList.contains('matched') || el.classList.contains('selected')) return;
    
    const clickedItem = matchingPairs[index];
    
    // If nothing selected
    if (matchingSelected === null) {
        matchingSelected = { index, item: clickedItem, el };
        el.classList.add('selected');
    } else {
        // Compare
        const first = matchingSelected;
        
        if (first.item.id === clickedItem.id && first.item.type !== clickedItem.type) {
            // MATCH!
            first.el.classList.remove('selected');
            first.el.classList.add('matched');
            el.classList.add('matched');
            
            matchingSelected = null;
            gameScore += 5;
            document.getElementById('game-score').textContent = gameScore;
            
            // Check win condition
            const matchedCount = document.querySelectorAll('.match-card.matched').length;
            if (matchedCount === matchingPairs.length) {
                document.getElementById('matching-status-msg').textContent = "🎉 Harika! Tüm kelimeleri eşleştirdiniz.";
                document.getElementById('matching-status-msg').style.color = "var(--success-color)";
                
                logReportActivity('testResult', 'correct');
                
                setTimeout(() => setupGameBoard(wordsDatabase.filter(w => w.language === activeLang)), 2000);
            }
        } else {
            // NO MATCH
            el.classList.add('error');
            first.el.classList.add('error');
            
            // Disable interaction during timeout
            document.getElementById('matching-grid-container').style.pointerEvents = 'none';
            
            logReportActivity('testResult', 'incorrect');
            
            setTimeout(() => {
                el.classList.remove('error', 'selected');
                first.el.classList.remove('error', 'selected');
                document.getElementById('matching-grid-container').style.pointerEvents = 'auto';
            }, 800);
            
            matchingSelected = null;
        }
    }
}

// 3. / 4. / 5. MULTIPLE CHOICE TESTS (EN-TR, TR-EN & 5 OPTIONS)
function setupMultipleChoiceBoard(wordsList, numOptions = 4, explicitDirection = null) {
    const direction = explicitDirection || (currentGameType === 'en-tr' ? 'en-tr' : 'tr-en');
    
    // Choose a target word
    currentTestWord = wordsList[Math.floor(Math.random() * wordsList.length)];
    
    // Generate incorrect answers from other words
    const others = wordsList.filter(w => w.id !== currentTestWord.id);
    const shuffledOthers = others.sort(() => 0.5 - Math.random());
    
    currentTestChoices = [];
    
    if (direction === 'en-tr') {
        // Correct Choice
        currentTestChoices.push({ wordObj: currentTestWord, correct: true, content: currentTestWord.meaning });
        // Incorrect choices
        for (let i = 0; i < Math.min(shuffledOthers.length, numOptions - 1); i++) {
            currentTestChoices.push({ wordObj: shuffledOthers[i], correct: false, content: shuffledOthers[i].meaning });
        }
    } else {
        // Correct Choice
        currentTestChoices.push({ wordObj: currentTestWord, correct: true, content: currentTestWord.word });
        // Incorrect choices
        for (let i = 0; i < Math.min(shuffledOthers.length, numOptions - 1); i++) {
            currentTestChoices.push({ wordObj: shuffledOthers[i], correct: false, content: shuffledOthers[i].word });
        }
    }
    
    // Shuffle choices
    currentTestChoices.sort(() => 0.5 - Math.random());
    
    const box = document.createElement('div');
    box.className = 'game-box';
    
    // Build Question Header
    const qDiv = document.createElement('div');
    qDiv.className = 'question-text';
    
    if (direction === 'en-tr') {
        qDiv.innerHTML = `Kelimenin Türkçe anlamı nedir?<br>`;
        const qVal = document.createElement('div');
        qVal.style.fontSize = '2.2rem';
        qVal.style.fontWeight = '800';
        qVal.style.color = 'var(--primary-color)';
        qVal.style.margin = '15px 0';
        renderCellContent(currentTestWord.word, qVal);
        qDiv.appendChild(qVal);
    } else {
        qDiv.innerHTML = `Hangi kelime şu anlama gelmektedir?<br>`;
        const qVal = document.createElement('div');
        qVal.style.fontSize = '2.2rem';
        qVal.style.fontWeight = '800';
        qVal.style.color = 'var(--primary-color)';
        qVal.style.margin = '15px 0';
        renderCellContent(currentTestWord.meaning, qVal);
        qDiv.appendChild(qVal);
    }
    
    box.appendChild(qDiv);
    
    // Choices container
    const list = document.createElement('div');
    list.className = 'choices-list';
    
    currentTestChoices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.id = `choice-btn-${index}`;
        
        renderCellContent(choice.content, btn);
        
        btn.onclick = () => {
            handleChoiceSelected(index, numOptions, wordsList);
        };
        
        list.appendChild(btn);
    });
    
    box.appendChild(list);
    
    // Optional clue box for extra guidance
    if (currentTestWord.memorySentence && currentTestWord.memorySentence.type === 'text' && currentTestWord.memorySentence.data) {
        const cBox = document.createElement('div');
        cBox.className = 'clue-box';
        cBox.style.marginTop = '20px';
        cBox.innerHTML = `<strong>Hafıza İpucu:</strong> ${getCleanText(currentTestWord.memorySentence.data)}`;
        box.appendChild(cBox);
    }
    
    document.getElementById('playground-body').appendChild(box);
}

function handleChoiceSelected(choiceIdx, numOptions, wordsList) {
    const list = document.querySelector('.choices-list');
    list.style.pointerEvents = 'none'; // Lock choices
    
    const selected = currentTestChoices[choiceIdx];
    const btn = document.getElementById(`choice-btn-${choiceIdx}`);
    
    if (selected.correct) {
        btn.classList.add('correct');
        gameScore += 10;
        document.getElementById('game-score').textContent = gameScore;
        logReportActivity('testResult', 'correct');
    } else {
        btn.classList.add('incorrect');
        // Show correct choice
        currentTestChoices.forEach((c, idx) => {
            if (c.correct) {
                document.getElementById(`choice-btn-${idx}`).classList.add('correct');
            }
        });
        logReportActivity('testResult', 'incorrect');
    }
    
    setTimeout(() => {
        setupMultipleChoiceBoard(wordsList, numOptions);
    }, 2000);
}

// 6. ZAMAN AYARLI KELİME TESTİ
function setupTimedBoard(wordsList) {
    const box = document.createElement('div');
    box.className = 'game-box';
    box.innerHTML = `
        <div class="setting-row">
            <span>Süreyi Ayarlayın:</span>
            <div class="time-btn-group">
                <button class="time-btn ${timedDuration === 3 ? 'active' : ''}" onclick="setTimedDuration(3, this)">3 sn</button>
                <button class="time-btn ${timedDuration === 5 ? 'active' : ''}" onclick="setTimedDuration(5, this)">5 sn</button>
                <button class="time-btn ${timedDuration === 7 ? 'active' : ''}" onclick="setTimedDuration(7, this)">7 sn</button>
                <button class="time-btn ${timedDuration === 10 ? 'active' : ''}" onclick="setTimedDuration(10, this)">10 sn</button>
            </div>
        </div>
        <div id="timed-word-screen" style="width: 100%;"></div>
    `;
    
    document.getElementById('playground-body').appendChild(box);
    
    startTimedRound(wordsList);
}

function setTimedDuration(duration, btnEl) {
    timedDuration = duration;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
}

function startTimedRound(wordsList) {
    const screen = document.getElementById('timed-word-screen');
    screen.innerHTML = '';
    
    // Choose word
    currentTestWord = wordsList[Math.floor(Math.random() * wordsList.length)];
    
    const timedDisplay = document.createElement('div');
    timedDisplay.className = 'timed-display-box';
    
    const wordVal = document.createElement('div');
    wordVal.style.fontSize = '3rem';
    renderCellContent(currentTestWord.word, wordVal);
    timedDisplay.appendChild(wordVal);
    
    const timerRing = document.createElement('div');
    timerRing.className = 'timer-ring';
    timerRing.id = 'timer-ring-val';
    timerRing.textContent = timedDuration;
    timedDisplay.appendChild(timerRing);
    
    screen.appendChild(timedDisplay);
    
    let timeRemaining = timedDuration;
    
    if (timedTimerId) clearInterval(timedTimerId);
    
    timedTimerId = setInterval(() => {
        timeRemaining--;
        document.getElementById('timer-ring-val').textContent = timeRemaining;
        
        if (timeRemaining <= 0) {
            clearInterval(timedTimerId);
            // Hide word, show choices
            timedDisplay.innerHTML = `<div style="font-size: 2rem; font-weight: bold;">⏳ Süre Bitti! Anlamını seçin:</div>`;
            showTimedChoices(wordsList, screen);
        }
    }, 1000);
}

function showTimedChoices(wordsList, container) {
    // Generate 8 choices
    const others = wordsList.filter(w => w.id !== currentTestWord.id);
    const shuffledOthers = others.sort(() => 0.5 - Math.random());
    
    currentTestChoices = [];
    currentTestChoices.push({ wordObj: currentTestWord, correct: true, content: currentTestWord.meaning });
    
    for (let i = 0; i < Math.min(shuffledOthers.length, 7); i++) {
        currentTestChoices.push({ wordObj: shuffledOthers[i], correct: false, content: shuffledOthers[i].meaning });
    }
    
    currentTestChoices.sort(() => 0.5 - Math.random());
    
    const list = document.createElement('div');
    list.className = 'choices-list';
    list.style.marginTop = '20px';
    
    currentTestChoices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.id = `choice-btn-${index}`;
        
        renderCellContent(choice.content, btn);
        
        btn.onclick = () => {
            handleTimedChoiceSelected(index, wordsList);
        };
        
        list.appendChild(btn);
    });
    
    container.appendChild(list);
}

function handleTimedChoiceSelected(choiceIdx, wordsList) {
    const list = document.querySelector('.choices-list');
    list.style.pointerEvents = 'none';
    
    const selected = currentTestChoices[choiceIdx];
    const btn = document.getElementById(`choice-btn-${choiceIdx}`);
    
    if (selected.correct) {
        btn.classList.add('correct');
        gameScore += 15;
        document.getElementById('game-score').textContent = gameScore;
        logReportActivity('testResult', 'correct');
    } else {
        btn.classList.add('incorrect');
        currentTestChoices.forEach((c, idx) => {
            if (c.correct) {
                document.getElementById(`choice-btn-${idx}`).classList.add('correct');
            }
        });
        logReportActivity('testResult', 'incorrect');
    }
    
    setTimeout(() => {
        startTimedRound(wordsList);
    }, 2000);
}

// 7. HAFIZAYA ALMA (SMART RECALL)
function setupMemoryBoard(wordsList) {
    const box = document.createElement('div');
    box.className = 'game-box';
    box.innerHTML = `
        <div class="setting-row">
            <span>Süreyi Ayarlayın:</span>
            <div class="time-btn-group">
                <button class="time-btn ${timedDuration === 3 ? 'active' : ''}" onclick="setTimedDuration(3, this)">3 sn</button>
                <button class="time-btn ${timedDuration === 5 ? 'active' : ''}" onclick="setTimedDuration(5, this)">5 sn</button>
                <button class="time-btn ${timedDuration === 7 ? 'active' : ''}" onclick="setTimedDuration(7, this)">7 sn</button>
                <button class="time-btn ${timedDuration === 10 ? 'active' : ''}" onclick="setTimedDuration(10, this)">10 sn</button>
            </div>
        </div>
        <div class="setting-row">
            <span>Yönü Ayarlayın:</span>
            <div class="time-btn-group">
                <button class="time-btn ${memoryDirection === 'en-tr' ? 'active' : ''}" onclick="setMemoryDirection('en-tr', this)">Hedef Dil ➔ TR</button>
                <button class="time-btn ${memoryDirection === 'tr-en' ? 'active' : ''}" onclick="setMemoryDirection('tr-en', this)">TR ➔ Hedef Dil</button>
            </div>
        </div>
        
        <div class="memory-card" id="memory-flashcard">
            <div class="memory-card-inner">
                <div class="memory-front" id="memory-front-val"></div>
                <div class="memory-back" id="memory-back-val"></div>
            </div>
        </div>
        
        <div id="memory-timer-display" style="font-weight: bold; font-size: 1.2rem; margin-bottom: 10px;">Gözüküyor...</div>
        <button class="btn-game-control" id="btn-next-memory" onclick="nextMemoryRound()">Sonraki Kart ➔</button>
    `;
    
    document.getElementById('playground-body').appendChild(box);
    
    document.getElementById('btn-next-memory').style.display = 'none';
    startMemoryRound(wordsList);
}

function setMemoryDirection(dir, btnEl) {
    memoryDirection = dir;
    btnEl.parentNode.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
}

function startMemoryRound(wordsList) {
    if (memoryTimerId) clearTimeout(memoryTimerId);
    
    const card = document.getElementById('memory-flashcard');
    card.classList.remove('revealed');
    
    document.getElementById('btn-next-memory').style.display = 'none';
    
    // Choose word
    currentTestWord = wordsList[Math.floor(Math.random() * wordsList.length)];
    
    const front = document.getElementById('memory-front-val');
    const back = document.getElementById('memory-back-val');
    
    front.innerHTML = '';
    back.innerHTML = '';
    
    if (memoryDirection === 'en-tr') {
        const valF = document.createElement('div');
        valF.style.fontSize = '2.5rem';
        renderCellContent(currentTestWord.word, valF);
        front.appendChild(valF);
        
        const valB = document.createElement('div');
        valB.style.fontSize = '2.2rem';
        valB.style.color = 'var(--primary-color)';
        renderCellContent(currentTestWord.meaning, valB);
        back.appendChild(valB);
        
        // Add pronunciation or memory Sentence inside back
        if (currentTestWord.pronunciation) {
            const pDiv = document.createElement('div');
            pDiv.style.fontSize = '1.1rem';
            pDiv.style.color = 'var(--text-light)';
            pDiv.style.marginTop = '10px';
            pDiv.innerHTML = `Okunuşu: `;
            const pVal = document.createElement('span');
            renderCellContent(currentTestWord.pronunciation, pVal);
            pDiv.appendChild(pVal);
            back.appendChild(pDiv);
        }
    } else {
        const valF = document.createElement('div');
        valF.style.fontSize = '2.5rem';
        renderCellContent(currentTestWord.meaning, valF);
        front.appendChild(valF);
        
        const valB = document.createElement('div');
        valB.style.fontSize = '2.2rem';
        valB.style.color = 'var(--primary-color)';
        renderCellContent(currentTestWord.word, valB);
        back.appendChild(valB);
    }
    
    // Add memory Sentence if exists
    if (currentTestWord.memorySentence) {
        const sDiv = document.createElement('div');
        sDiv.style.fontSize = '1.2rem';
        sDiv.style.marginTop = '15px';
        sDiv.style.borderTop = '1px dashed var(--border-color)';
        sDiv.style.paddingTop = '10px';
        renderCellContent(currentTestWord.memorySentence, sDiv);
        back.appendChild(sDiv);
    }
    
    let countdown = timedDuration;
    document.getElementById('memory-timer-display').textContent = `${countdown} saniye kaldı...`;
    
    function tick() {
        countdown--;
        if (countdown <= 0) {
            // Flip card
            card.classList.add('revealed');
            document.getElementById('memory-timer-display').textContent = "Hafıza Kartı Çevrildi!";
            document.getElementById('btn-next-memory').style.display = 'block';
            logReportActivity('testSolved');
        } else {
            document.getElementById('memory-timer-display').textContent = `${countdown} saniye kaldı...`;
            memoryTimerId = setTimeout(tick, 1000);
        }
    }
    
    memoryTimerId = setTimeout(tick, 1000);
}

function nextMemoryRound() {
    startMemoryRound(wordsDatabase.filter(w => w.language === activeLang));
}

// REPORTS DISPLAY MODULE
function updateReportUI() {
    getWords(words => {
        const langWords = words.filter(w => w.language === activeLang);
        document.getElementById('rep-total-words').textContent = langWords.length;
        
        getReports(reports => {
            const todayStr = getTodayDateStr();
            const todayLog = reports.find(r => r.date === todayStr);
            
            const wordsToday = todayLog ? todayLog.wordsWritten : 0;
            const testsToday = todayLog ? todayLog.testsSolved : 0;
            
            document.getElementById('rep-today-words').textContent = wordsToday;
            document.getElementById('rep-today-tests').textContent = testsToday;
            
            let rate = 0;
            if (todayLog && todayLog.testsSolved > 0) {
                rate = Math.round((todayLog.correctAnswers / todayLog.testsSolved) * 100);
            }
            document.getElementById('rep-success-rate').textContent = `${rate}%`;
            
            // Build report logs table
            const tbody = document.getElementById('reports-table-body');
            tbody.innerHTML = '';
            
            if (reports.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-light)">Kayıt yok.</td></tr>`;
                return;
            }
            
            // Sort by date desc
            const sortedReports = [...reports].sort((a, b) => {
                const partsA = a.date.split('.');
                const partsB = b.date.split('.');
                if (partsA.length === 3 && partsB.length === 3) {
                    const dA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
                    const dB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
                    return dB - dA;
                }
                return b.date.localeCompare(a.date);
            });
            
            sortedReports.forEach(r => {
                const tr = document.createElement('tr');
                const scoreRate = r.testsSolved > 0 ? Math.round((r.correctAnswers / r.testsSolved) * 100) : 0;
                
                tr.innerHTML = `
                    <td><strong>${r.date}</strong></td>
                    <td>${r.wordsWritten} Kelime</td>
                    <td>${r.testsSolved} Soru</td>
                    <td><span style="color: var(--success-color); font-weight: bold">${r.correctAnswers}</span></td>
                    <td><span style="color: var(--danger-color); font-weight: bold">${r.incorrectAnswers}</span></td>
                    <td><strong>${scoreRate}%</strong></td>
                `;
                tbody.appendChild(tr);
            });
        });
    });
}

// BACKUP IMPORT & EXPORT
function exportBackupData() {
    getWords(words => {
        getReports(reports => {
            const backup = {
                version: '1.0.0',
                language: activeLang,
                words: words.filter(w => w.language === activeLang),
                reports: reports
            };
            
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", `tablet_kelime_${activeLang}_backup.json`);
            dlAnchorElem.click();
        });
    });
}

function importBackupData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.words || !Array.isArray(data.words)) {
                alert("Hatalı dosya formatı! Yedek yüklenemedi.");
                return;
            }
            
            if (confirm(`Bu dosyadaki ${data.words.length} kelimeyi veritabanınıza eklemek istiyor musunuz?`)) {
                // Bulk save
                saveWords(data.words, () => {
                    // Save reports too if they exist
                    if (data.reports && Array.isArray(data.reports)) {
                        data.reports.forEach(r => saveReport(r));
                    }
                    
                    alert("Yedek başarıyla yüklendi!");
                    getWords(() => {
                        loadAlphabeticalList();
                        loadArchiveList();
                        updateReportUI();
                    });
                });
            }
        } catch (err) {
            console.error("Yedek yükleme hatası:", err);
            alert("Dosya çözümlenirken hata oluştu!");
        }
    };
    reader.readAsText(file);
}

// WORD DOCUMENT (.DOCX) IMPORT ENGINE
function handleWordDocxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        
        // Use mammoth to convert docx to HTML
        mammoth.convertToHtml({ arrayBuffer: arrayBuffer })
            .then(result => {
                const html = result.value;
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const table = doc.querySelector('table');
                
                if (!table) {
                    alert("Word belgesinde bir tablo bulunamadı! Lütfen belgenizde 6 sütunlu bir tablo olduğundan emin olun.");
                    return;
                }
                
                const rows = table.querySelectorAll('tr');
                if (rows.length <= 1) {
                    alert("Tabloda veri satırı bulunamadı! İlk satır başlık olarak atlanır.");
                    return;
                }
                
                const parsedWords = [];
                const todayStr = getTodayDateStr();
                
                // Start from index 1 to skip headers
                for (let i = 1; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length >= 6) {
                        const wordRaw = cells[0].innerHTML.trim();
                        const wordClean = cells[0].textContent.replace(/<[^>]*>/g, '').toLowerCase().trim();
                        const meaningRaw = cells[2].innerHTML.trim();
                        
                        // Ensure we have at least a word or a meaning
                        if (wordClean || meaningRaw) {
                            const wordObj = {
                                id: Date.now() + i, // Unique ID per row
                                language: activeLang,
                                date: todayStr,
                                word: { type: 'text', data: cells[0].innerHTML.trim() },
                                pronunciation: { type: 'text', data: cells[1].innerHTML.trim() },
                                meaning: { type: 'text', data: cells[2].innerHTML.trim() },
                                memorySentence: { type: 'text', data: cells[3].innerHTML.trim() },
                                synonyms: { type: 'text', data: cells[4].innerHTML.trim() },
                                antonyms: { type: 'text', data: cells[5].innerHTML.trim() },
                                wordText: wordClean || 'untitled_' + (Date.now() + i),
                                createdAt: Date.now()
                            };
                            parsedWords.push(wordObj);
                        }
                    }
                }
                
                if (parsedWords.length === 0) {
                    alert("Tablodan geçerli bir kelime okunamadı! Lütfen sütun düzenini kontrol edin.");
                    return;
                }
                
                if (confirm(`Word belgesinden ${parsedWords.length} adet kelime algılandı. Veritabanına kaydetmek istiyor musunuz?`)) {
                    saveWords(parsedWords, () => {
                        logReportActivity('wordWritten', parsedWords.length);
                        alert(`${parsedWords.length} kelime başarıyla veritabanına yüklendi ve kaydedildi!`);
                        getWords(() => {
                            loadAlphabeticalList();
                            loadArchiveList();
                            updateReportUI();
                        });
                    });
                }
            })
            .catch(err => {
                console.error("Word okuma hatası:", err);
                alert("Word belgesi çözümlenirken hata oluştu! Dosyanın bozuk olmadığından emin olun.");
            });
    };
    reader.readAsArrayBuffer(file);
    // Reset file input value to allow selecting same file again
    event.target.value = '';
}

