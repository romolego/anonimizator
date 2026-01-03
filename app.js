// Глобальные переменные
let workbook = null;
let currentSheet = null;
let tableData = []; // Массив объектов: {original: value, tokenized: value|null, isTokenized: boolean} для каждой ячейки
let tokenDictionary = new Map(); // original -> token
let reverseDictionary = new Map(); // token -> original
let currentDictionary = new Map(); // для детокенизации
let selectedColumns = new Set(); // выбранные столбцы для токенизации (жёлтые)
let tokenizedColumns = new Set(); // токенизированные столбцы (зелёные)
let viewMode = 'original'; // 'tokenized', 'original', 'both'
let hasTokenizedData = false; // есть ли токенизированные данные
let hasAutoSwitchedToTokenView = false; // автопереключение в режим токенов выполнено
let tokenizationStartRow = 1; // Первая строка, участвующая в токенизации (1-based)
let tokenizationMarkerRow = 1; // Строка, напротив которой стоит маркер (1-based)
let isMarkerEnabled = true; // Включен ли маркер исключения верхних строк
let currentExportId = null; // ID для текущей сессии экспорта
let tableExported = false; // Флаг экспорта таблицы
let dictionaryExported = false; // Флаг экспорта словаря
let markerGhostElement = null;
let isMarkerDragging = false;
let markerDragActivated = false;
let markerDragCandidateRow = 1;
let markerDragStart = { x: 0, y: 0 };

// Пересчитать стартовую строку токенизации на основе маркера
function recalculateTokenizationStartRow() {
    const totalRows = tableData.length;
    const safeTotal = Math.max(1, totalRows);
    tokenizationMarkerRow = Math.max(1, Math.min(tokenizationMarkerRow, safeTotal));

    if (!isMarkerEnabled) {
        tokenizationStartRow = 1;
        return;
    }

    tokenizationStartRow = tokenizationMarkerRow;
}

// Получить 0-based индекс стартовой строки
function getTokenizationStartIndex() {
    return Math.max(0, tokenizationStartRow - 1);
}

// Проверить, исключена ли строка из токенизации (выше или на маркере)
function isRowExcludedFromTokenization(rowIndex) {
    return rowIndex < getTokenizationStartIndex();
}

// Обновить доступность режимов отображения
function updateViewModeAvailability() {
    const select = document.getElementById('viewModeSelect');
    if (!select) return;

    const tokenizedOption = select.querySelector('option[value="tokenized"]');
    const bothOption = select.querySelector('option[value="both"]');
    const hasTokens = hasTokenizedData && tokenizedColumns.size > 0;

    if (tokenizedOption) tokenizedOption.disabled = !hasTokens;
    if (bothOption) bothOption.disabled = !hasTokens;

    if (!hasTokens && (viewMode === 'tokenized' || viewMode === 'both')) {
        viewMode = 'original';
        select.value = 'original';
    }
}

// Загрузка файла
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        workbook = XLSX.read(data, {type: 'array'});
        
        // Показать выбор листа (всегда)
        const sheetNames = workbook.SheetNames;
        const sheetSelect = document.getElementById('sheetSelect');
        const sheetSelectionWrapper = document.getElementById('sheetSelectionWrapper');
        sheetSelect.innerHTML = '';
        
        // Всегда показываем select, даже если лист один
        sheetNames.forEach((name, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = name;
            sheetSelect.appendChild(option);
        });
        sheetSelectionWrapper.style.display = 'flex';
        sheetSelect.onchange = function() {
            // При смене листа сбрасываем состояние, но не строим таблицу
            selectedColumns.clear();
            tokenizedColumns.clear();
            tableData = [];
            hasTokenizedData = false;
            hasAutoSwitchedToTokenView = false;
            viewMode = 'original';
            tokenizationMarkerRow = 1;
            isMarkerEnabled = true;
            tokenizationStartRow = 1;
            hideAnchorControlPanel();
            const viewModeSelectInner = document.getElementById('viewModeSelect');
            if (viewModeSelectInner) {
                viewModeSelectInner.value = 'original';
            }
            updateViewModeAvailability();
            document.getElementById('tableSection').style.display = 'none';
            document.getElementById('viewModeWrapper').style.display = 'none';
            document.getElementById('fontSizeWrapper').style.display = 'none';
            document.getElementById('downloadSection').style.display = 'none';
        };
        
        document.getElementById('clearButton').style.display = 'inline-block';
        document.getElementById('recognizeButton').style.display = 'inline-block';
    };
    reader.readAsArrayBuffer(file);
});

// Распознать данные (построить таблицу)
function recognizeData() {
    if (!workbook) {
        alert('Сначала выберите файл');
        return;
    }
    
    const sheetSelect = document.getElementById('sheetSelect');
    let sheetIndex = 0;
    if (sheetSelect && sheetSelect.value !== undefined && sheetSelect.value !== '') {
        sheetIndex = parseInt(sheetSelect.value);
    }
    
    currentSheet = workbook.Sheets[workbook.SheetNames[sheetIndex]];
    const rawData = XLSX.utils.sheet_to_json(currentSheet, {header: 1, defval: ''});
    
    // Инициализировать структуру данных
    const maxCols = Math.max(...rawData.map(row => row.length), 0);
    tableData = rawData.map(row => {
        const cellData = [];
        for (let i = 0; i < maxCols; i++) {
            const value = row[i] || '';
            cellData.push({
                original: value,
                tokenized: null,
                isTokenized: false
            });
        }
        return cellData;
    });
    
    // Сбросить состояние
    selectedColumns.clear();
    tokenizedColumns.clear();
    hasTokenizedData = false;
    hasAutoSwitchedToTokenView = false;
    viewMode = 'original';
    tokenizationMarkerRow = 1;
    isMarkerEnabled = true;
    recalculateTokenizationStartRow();
    currentExportId = null;
    tableExported = false;
    dictionaryExported = false;
    const viewModeSelect = document.getElementById('viewModeSelect');
    if (viewModeSelect) {
        viewModeSelect.value = 'original';
    }
    document.getElementById('viewModeWrapper').style.display = 'flex';
    document.getElementById('fontSizeWrapper').style.display = 'flex';
    document.getElementById('downloadSection').style.display = 'none';
    updateViewModeAvailability();
    
    // Построить таблицу
    displayTable();
    document.getElementById('tableSection').style.display = 'block';
    
    // Инициализировать синхронизацию скролла и якорь токенизации
    setupTableScrollSync();
    setupTokenizationAnchor();
}

// Показать модальное окно подтверждения очистки
function showClearModal() {
    const modal = document.getElementById('clearModal');
    const warning = document.getElementById('clearModalWarning');
    const message = document.getElementById('clearModalMessage');
    
    // Проверить, нужно ли предупреждение о словаре
    if (tableExported && !dictionaryExported) {
        warning.style.display = 'block';
        message.textContent = 'Вы уверены, что хотите очистить все данные?';
    } else {
        warning.style.display = 'none';
        message.textContent = 'Вы уверены, что хотите очистить все данные?';
    }
    
    modal.classList.add('show');
}

// Закрыть модальное окно
function closeClearModal() {
    const modal = document.getElementById('clearModal');
    modal.classList.remove('show');
}

// Подтверждение очистки
function confirmClear() {
    closeClearModal();
    performClear();
}

// Очистка всего состояния
function clearAll() {
    showClearModal();
}

function performClear() {
    workbook = null;
    currentSheet = null;
    tableData = [];
    tokenDictionary.clear();
    reverseDictionary.clear();
    currentDictionary.clear();
    selectedColumns.clear();
    tokenizedColumns.clear();
    hasTokenizedData = false;
    hasAutoSwitchedToTokenView = false;
    viewMode = 'original';
    tokenizationStartRow = 1;
    tokenizationMarkerRow = 1;
    isMarkerEnabled = true;
    currentExportId = null;
    tableExported = false;
    dictionaryExported = false;
    clearMarkerGhost();
    updateViewModeAvailability();
    
    // Очистить UI
    document.getElementById('fileInput').value = '';
    const sheetSelect = document.getElementById('sheetSelect');
    sheetSelect.innerHTML = '';
    document.getElementById('sheetSelectionWrapper').style.display = 'flex';
    document.getElementById('clearButton').style.display = 'none';
    document.getElementById('recognizeButton').style.display = 'none';
    document.getElementById('tableSection').style.display = 'none';
    document.getElementById('viewModeWrapper').style.display = 'none';
    document.getElementById('fontSizeWrapper').style.display = 'none';
    document.getElementById('dataTable').innerHTML = '';
    document.getElementById('downloadSection').style.display = 'none';
    
    // Очистить якорь токенизации
    const gutter = document.getElementById('tableAnchorGutter');
    if (gutter) {
        gutter.innerHTML = '';
    }
    
    // Очистить детокенизацию
    document.getElementById('jsonInput').value = '';
    document.getElementById('jsonFileName').textContent = '';
    document.getElementById('responseTextarea').value = '';
    document.getElementById('tokensList').innerHTML = '';
    document.getElementById('detokenizedText').innerHTML = '';
    document.getElementById('statsSummary').innerHTML = '';
}

// Отображение таблицы
function displayTable() {
    const table = document.getElementById('dataTable');
    table.innerHTML = '';
    
    if (tableData.length === 0) return;

    // Пересчитать стартовую строку на случай изменения числа строк
    recalculateTokenizationStartRow();
    clearMarkerDragHighlight();
    
    // Обновить синхронизацию скролла и якорь после отрисовки
    setTimeout(() => {
        setupTableScrollSync();
        setupTokenizationAnchor();
    }, 100);
    
    const maxCols = tableData[0].length;
    const showTokensView = viewMode === 'tokenized' || viewMode === 'both';
    
    // Создать заголовки с чекбоксами
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        
        // Определить класс цвета столбца
        if (tokenizedColumns.has(i) && showTokensView) {
            th.className = 'column-tokenized';
        } else if (selectedColumns.has(i)) {
            th.className = 'column-selected';
        }
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'column-checkbox';
        checkbox.value = i;
        checkbox.checked = selectedColumns.has(i) || tokenizedColumns.has(i);
        // Чекбоксы всегда активны (не отключаем для токенизированных столбцов)
        checkbox.addEventListener('change', function() {
            toggleColumnSelection(parseInt(this.value));
        });
        
        th.appendChild(checkbox);
        
        const labelText = document.createTextNode(` Столбец ${i + 1}`);
        th.appendChild(labelText);
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Создать строки данных
    const tbody = document.createElement('tbody');
    tableData.forEach((rowData, rowIndex) => {
        const tr = document.createElement('tr');
        const isExcludedRow = isRowExcludedFromTokenization(rowIndex);
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            const cellInfo = rowData[i];
            
            // Определить класс цвета столбца
            let cellClasses = [];
            const showTokenColor = showTokensView && !isExcludedRow;
            const showSelectedColor = !isExcludedRow;

            if (showTokenColor && tokenizedColumns.has(i)) {
                cellClasses.push('column-tokenized');
            } else if (showSelectedColor && selectedColumns.has(i)) {
                cellClasses.push('column-selected');
            }
            
            // Отобразить значение в зависимости от режима просмотра
            if (isExcludedRow || !cellInfo.isTokenized || !hasTokenizedData || (!showTokensView)) {
                // Нетокенизированная ячейка или нет токенизированных данных
                td.textContent = cellInfo.original;
                td.title = '';
            } else {
                // Токенизированная ячейка
                if (viewMode === 'tokenized') {
                    td.textContent = cellInfo.tokenized;
                    td.title = cellInfo.original; // Tooltip с исходным значением
                    cellClasses.push('cell-tooltip');
                } else if (viewMode === 'original') {
                    td.textContent = cellInfo.original;
                    td.title = cellInfo.tokenized; // Tooltip с токеном
                    cellClasses.push('cell-tooltip');
                } else if (viewMode === 'both') {
                    const div = document.createElement('div');
                    div.className = 'cell-both-view';
                    const origDiv = document.createElement('div');
                    origDiv.className = 'cell-original-value';
                    origDiv.textContent = cellInfo.original;
                    const tokenDiv = document.createElement('div');
                    tokenDiv.className = 'cell-tokenized-value';
                    tokenDiv.textContent = cellInfo.tokenized;
                    div.appendChild(origDiv);
                    div.appendChild(tokenDiv);
                    td.appendChild(div);
                    td.title = '';
                }
            }
            
            // Установить классы ячейки
            if (cellClasses.length > 0) {
                td.className = cellClasses.join(' ');
            }
            
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

// Переключение выбора столбца
function toggleColumnSelection(colIndex) {
    if (tokenizedColumns.has(colIndex)) {
        // Отмена токенизации столбца
        untokenizeColumn(colIndex);
    } else {
        // Обычное переключение выбора
        if (selectedColumns.has(colIndex)) {
            selectedColumns.delete(colIndex);
        } else {
            selectedColumns.add(colIndex);
        }
    }
    
    displayTable();
}

// Отмена токенизации столбца
function untokenizeColumn(colIndex) {
    if (!tokenizedColumns.has(colIndex)) {
        return;
    }
    
    // Вернуть исходные значения
    tableData.forEach((rowData) => {
        const cellInfo = rowData[colIndex];
        if (cellInfo.isTokenized) {
            const token = cellInfo.tokenized;
            // Удалить токен из словарей, если он больше не используется
            cellInfo.tokenized = null;
            cellInfo.isTokenized = false;
            
            // Проверить, используется ли токен в других столбцах
            let tokenStillUsed = false;
            tableData.forEach((otherRowData) => {
                for (let i = 0; i < otherRowData.length; i++) {
                    if (i !== colIndex && otherRowData[i].tokenized === token) {
                        tokenStillUsed = true;
                        break;
                    }
                }
            });
            
            // Если токен больше не используется, удалить из словарей
            if (!tokenStillUsed && token) {
                const originalValue = reverseDictionary.get(token);
                if (originalValue) {
                    tokenDictionary.delete(originalValue);
                    reverseDictionary.delete(token);
                }
            }
        }
    });
    
    // Убрать столбец из токенизированных
    tokenizedColumns.delete(colIndex);
    
    // Если больше нет токенизированных данных, скорректировать состояние
    if (tokenizedColumns.size === 0) {
        hasTokenizedData = false;
        document.getElementById('downloadSection').style.display = 'none';
        // Сбросить ID экспорта при отмене всех токенизаций
        currentExportId = null;
        viewMode = 'original';
        const select = document.getElementById('viewModeSelect');
        if (select) {
            select.value = 'original';
        }
    }

    updateViewModeAvailability();
}

// Настройка визуального якоря токенизации
function setupTokenizationAnchor() {
    const gutter = document.getElementById('tableAnchorGutter');
    const table = document.getElementById('dataTable');
    const tableContainer = document.getElementById('tableContainer');
    
    if (!gutter || !table || tableData.length === 0) {
        clearMarkerGhost();
        return;
    }
    
    const dataRows = table.querySelectorAll('tbody tr');
    if (dataRows.length === 0) return;
    
    const headerHeight = table.querySelector('thead')?.offsetHeight || 0;
    gutter.innerHTML = '';
    gutter.style.paddingTop = headerHeight + 'px';
    gutter.style.height = table.offsetHeight + 'px';
    gutter.style.maxHeight = tableContainer.offsetHeight + 'px';
    gutter.style.overflowY = 'auto';
    
    const rowsWrapper = document.createElement('div');
    rowsWrapper.className = 'table-anchor-rows';

    let markerRowElement = null;
    dataRows.forEach((rowEl, index) => {
        const anchorRow = document.createElement('div');
        anchorRow.className = 'table-anchor-row';
        anchorRow.style.height = `${rowEl.offsetHeight || 30}px`;

        if (tokenizationMarkerRow === index + 1) {
            const dot = document.createElement('div');
            dot.className = 'anchor-dot active';
            if (!isMarkerEnabled) {
                dot.classList.add('disabled');
            }
            dot.title = isMarkerEnabled ? 'Начало токенизации' : 'Маркер выключен';
            registerMarkerInteractions(dot, anchorRow);
            anchorRow.appendChild(dot);
            markerRowElement = anchorRow;
        }

        rowsWrapper.appendChild(anchorRow);
    });
    
    gutter.appendChild(rowsWrapper);
    
    // Синхронизация скролла gutter с таблицей
    tableContainer.onscroll = function() {
        gutter.scrollTop = tableContainer.scrollTop;
    };
    
    gutter.onscroll = function() {
        tableContainer.scrollTop = gutter.scrollTop;
    };
    
    gutter.scrollTop = tableContainer.scrollTop;

    if (!markerRowElement) {
        clearMarkerGhost();
    }
}

function setMarkerRow(rowNumber) {
    tokenizationMarkerRow = Math.max(1, Math.min(rowNumber, Math.max(1, tableData.length)));
    recalculateTokenizationStartRow();
    displayTable();
    setupTokenizationAnchor();
}

function toggleMarkerEnabled() {
    isMarkerEnabled = !isMarkerEnabled;
    recalculateTokenizationStartRow();
    displayTable();
    setupTokenizationAnchor();
}

function registerMarkerInteractions(dotElement, rowElement) {
    if (!dotElement || !rowElement) return;

    dotElement.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        startMarkerDrag(e, rowElement);
    });
}

function startMarkerDrag(e, rowElement) {
    isMarkerDragging = true;
    markerDragActivated = false;
    markerDragCandidateRow = tokenizationMarkerRow;
    markerDragStart = { x: e.clientX, y: e.clientY };

    clearMarkerDragHighlight();

    document.addEventListener('mousemove', onMarkerDragMove);
    document.addEventListener('mouseup', endMarkerDrag);
    document.addEventListener('mouseleave', endMarkerDrag);

    const dot = rowElement.querySelector('.anchor-dot');
    if (dot) {
        dot.classList.add('dragging');
        dot.classList.add('drag-hidden');
    }
}

function onMarkerDragMove(e) {
    if (!isMarkerDragging) return;

    const dx = e.clientX - markerDragStart.x;
    const dy = e.clientY - markerDragStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (!markerDragActivated && distance > 3) {
        markerDragActivated = true;
    }
    if (!markerDragActivated) return;

    const gutter = document.getElementById('tableAnchorGutter');
    if (!gutter) return;
    const rows = gutter.querySelectorAll('.table-anchor-row');
    if (!rows.length) return;

    const candidate = resolveMarkerRowByPointer(e.clientY, rows, gutter);
    if (candidate !== null) {
        markerDragCandidateRow = candidate;
        applyMarkerDragHighlight(candidate);
    }

    handleMarkerAutoScroll(e.clientY, gutter);
}

function endMarkerDrag(e) {
    if (!isMarkerDragging) return;

    document.removeEventListener('mousemove', onMarkerDragMove);
    document.removeEventListener('mouseup', endMarkerDrag);
    document.removeEventListener('mouseleave', endMarkerDrag);

    const gutter = document.getElementById('tableAnchorGutter');
    if (gutter) {
        const activeDot = gutter.querySelector('.anchor-dot.dragging');
        if (activeDot) {
            activeDot.classList.remove('dragging');
            activeDot.classList.remove('drag-hidden');
        }
    }

    const wasActiveDrag = markerDragActivated;
    const candidateRow = markerDragCandidateRow;
    isMarkerDragging = false;
    markerDragActivated = false;

    if (wasActiveDrag) {
        clearMarkerDragHighlight();
        clearMarkerGhost();
        setMarkerRow(candidateRow);
    } else {
        // Короткий клик без drag — переключение маркера
        toggleMarkerEnabled();
        clearMarkerGhost();
        setupTokenizationAnchor();
    }
}

function resolveMarkerRowByPointer(clientY, rows, gutter) {
    let candidate = null;
    let minDistance = Infinity;
    rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            candidate = index + 1;
            minDistance = 0;
        } else {
            const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
            if (distance < minDistance) {
                minDistance = distance;
                candidate = index + 1;
            }
        }
    });
    if (candidate === null) {
        return 1;
    }
    const total = Math.max(1, rows.length);
    return Math.max(1, Math.min(candidate, total));
}

function clearMarkerDragHighlight() {
    const gutter = document.getElementById('tableAnchorGutter');
    const table = document.getElementById('dataTable');
    if (gutter) {
        gutter.querySelectorAll('.table-anchor-row.drag-hover').forEach(el => el.classList.remove('drag-hover'));
    }
    if (table) {
        table.querySelectorAll('tbody tr.drag-hover').forEach(el => el.classList.remove('drag-hover'));
    }
    clearMarkerGhost();
}

function applyMarkerDragHighlight(rowNumber) {
    const gutter = document.getElementById('tableAnchorGutter');
    const table = document.getElementById('dataTable');
    clearMarkerDragHighlight();

    const gutterRows = gutter ? gutter.querySelectorAll('.table-anchor-row') : [];
    const tableRows = table ? table.querySelectorAll('tbody tr') : [];

    if (gutterRows[rowNumber - 1]) {
        gutterRows[rowNumber - 1].classList.add('drag-hover');
    }
    if (tableRows[rowNumber - 1]) {
        tableRows[rowNumber - 1].classList.add('drag-hover');
    }

    showMarkerGhost(rowNumber);
}

function handleMarkerAutoScroll(clientY, gutter) {
    if (!gutter) return;
    const rect = gutter.getBoundingClientRect();
    const edge = 24;
    const scrollStep = 20;

    if (clientY < rect.top + edge) {
        gutter.scrollTop = Math.max(0, gutter.scrollTop - scrollStep);
    } else if (clientY > rect.bottom - edge) {
        const maxScroll = gutter.scrollHeight - gutter.clientHeight;
        gutter.scrollTop = Math.min(maxScroll, gutter.scrollTop + scrollStep);
    }
}

function positionAnchorControlPanel(targetRowElement) {
    const gutter = document.getElementById('tableAnchorGutter');
    if (!gutter || !targetRowElement) return;
}

function showMarkerGhost(rowNumber) {
    const gutter = document.getElementById('tableAnchorGutter');
    if (!gutter) return;
    const gutterRows = gutter.querySelectorAll('.table-anchor-row');
    const targetRow = gutterRows[rowNumber - 1];
    if (!targetRow) return;

    if (!markerGhostElement) {
        markerGhostElement = document.createElement('div');
        markerGhostElement.className = 'anchor-dot drag-ghost';
    }

    if (markerGhostElement.parentElement !== targetRow) {
        markerGhostElement.remove();
        targetRow.appendChild(markerGhostElement);
    }
}

function clearMarkerGhost() {
    if (markerGhostElement && markerGhostElement.parentElement) {
        markerGhostElement.parentElement.removeChild(markerGhostElement);
    }
}

// Генерация base64url токена
function generateToken() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    
    // Конвертировать в base64
    let binary = '';
    array.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    let base64 = btoa(binary);
    
    // Конвертировать base64 в base64url
    base64 = base64.replace(/\+/g, '-');
    base64 = base64.replace(/\//g, '_');
    base64 = base64.replace(/=/g, ''); // Убрать padding
    
    return `[[${base64}]]`;
}

// Токенизация столбцов (накопительная)
function tokenizeColumns() {
    if (selectedColumns.size === 0) {
        alert('Выберите хотя бы один столбец для токенизации');
        return;
    }

    recalculateTokenizationStartRow();
    
    const hadTokensBefore = hasTokenizedData && tokenizedColumns.size > 0;
    let tokenCreated = false;
    
    // Токенизировать только выбранные (жёлтые) столбцы
    selectedColumns.forEach(colIndex => {
        tableData.forEach((rowData, rowIndex) => {
            const cellInfo = rowData[colIndex];
            const originalValue = cellInfo.original;
            
            // Пропустить пустые значения
            if (!originalValue || originalValue.toString().trim() === '') {
                return;
            }
            
            const valueStr = originalValue.toString();
            
            // Если значение уже есть в словаре, использовать существующий токен
            if (tokenDictionary.has(valueStr)) {
                cellInfo.tokenized = tokenDictionary.get(valueStr);
            } else {
                // Сгенерировать новый токен
                const token = generateToken();
                tokenDictionary.set(valueStr, token);
                reverseDictionary.set(token, valueStr);
                cellInfo.tokenized = token;
            }
            
            cellInfo.isTokenized = true;
            tokenCreated = true;
        });
        
        // Переместить столбец из selectedColumns в tokenizedColumns
        tokenizedColumns.add(colIndex);
        selectedColumns.delete(colIndex);
    });
    
    hasTokenizedData = hasTokenizedData || tokenCreated;
    const hasTokensNow = hasTokenizedData && tokenizedColumns.size > 0;
    
    // Сбросить ID экспорта при новой токенизации (новая сессия)
    currentExportId = null;
    
    // Показать экспорт
    document.getElementById('downloadSection').style.display = 'block';
    updateViewModeAvailability();
    if (!hasAutoSwitchedToTokenView && !hadTokensBefore && hasTokensNow) {
        viewMode = 'tokenized';
        const viewSelect = document.getElementById('viewModeSelect');
        if (viewSelect) {
            viewSelect.value = 'tokenized';
        }
        hasAutoSwitchedToTokenView = true;
    }
    
    // Обновить отображение таблицы
    displayTable();
    
    // Обновить синхронизацию скролла
    setupTableScrollSync();
}

// Настройка синхронизации горизонтального скролла таблицы
let syncTopScrollHandler = null;
let syncBottomScrollHandler = null;

function setupTableScrollSync() {
    const tableContainer = document.getElementById('tableContainer');
    const tableScrollTop = document.getElementById('tableScrollTop');
    
    if (!tableContainer || !tableScrollTop) return;
    
    const table = document.getElementById('dataTable');
    if (!table) return;
    
    // Проверить, нужен ли горизонтальный скролл
    const needsScroll = table.scrollWidth > tableContainer.clientWidth;
    
    if (needsScroll) {
        tableScrollTop.style.display = 'block';
        
        // Удалить старые обработчики, если они есть
        if (syncTopScrollHandler) {
            tableContainer.removeEventListener('scroll', syncTopScrollHandler);
        }
        if (syncBottomScrollHandler) {
            tableScrollTop.removeEventListener('scroll', syncBottomScrollHandler);
        }
        
        // Синхронизация: нижний скролл -> верхний
        syncTopScrollHandler = function() {
            if (tableScrollTop.scrollLeft !== tableContainer.scrollLeft) {
                tableScrollTop.scrollLeft = tableContainer.scrollLeft;
            }
        };
        
        // Синхронизация: верхний скролл -> нижний
        syncBottomScrollHandler = function() {
            if (tableContainer.scrollLeft !== tableScrollTop.scrollLeft) {
                tableContainer.scrollLeft = tableScrollTop.scrollLeft;
            }
        };
        
        // Установить ширину верхнего скролла равной ширине таблицы
        const scrollWidth = table.scrollWidth;
        tableScrollTop.style.width = '100%';
        
        // Создать невидимый элемент для прокрутки
        const scrollContent = document.createElement('div');
        scrollContent.style.width = scrollWidth + 'px';
        scrollContent.style.height = '1px';
        tableScrollTop.innerHTML = '';
        tableScrollTop.appendChild(scrollContent);
        
        // Добавить обработчики
        tableContainer.addEventListener('scroll', syncTopScrollHandler);
        tableScrollTop.addEventListener('scroll', syncBottomScrollHandler);
    } else {
        tableScrollTop.style.display = 'none';
    }
}

// Обновление режима отображения таблицы
function updateTableView() {
    const select = document.getElementById('viewModeSelect');
    viewMode = select.value;
    displayTable();
}

// Обновление размера шрифта таблицы
function updateTableFontSize() {
    const select = document.getElementById('fontSizeSelect');
    const fontSize = select.value;
    const table = document.getElementById('dataTable');
    const tableContainer = table.closest('.table-wrapper');
    
    // Удалить все классы размера шрифта
    tableContainer.classList.remove('table-font-size-10px', 'table-font-size-12px', 
                                     'table-font-size-14px', 'table-font-size-16px', 
                                     'table-font-size-18px');
    
    // Добавить новый класс
    tableContainer.classList.add(`table-font-size-${fontSize.replace('px', 'px')}`);
    
    // Также применить напрямую к таблице для немедленного эффекта
    table.style.fontSize = fontSize;
    const allCells = table.querySelectorAll('th, td');
    allCells.forEach(cell => {
        cell.style.fontSize = fontSize;
    });

    // Обновить высоту маркеров после изменения шрифта
    setupTokenizationAnchor();
}

// Генерация ID для экспорта
function generateExportId() {
    if (!currentExportId) {
        // Генерируем короткий уникальный ID (8 символов)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        currentExportId = id;
    }
    return currentExportId;
}

// Форматирование даты и времени для имени файла
function formatDateTimeForFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}`;
}

// Скачать CSV
function downloadCSV() {
    if (tableData.length === 0) return;
    
    recalculateTokenizationStartRow();
    const exportId = generateExportId();
    const dateTime = formatDateTimeForFilename();
    
    // Получить данные для экспорта (токенизированные значения)
    const startRow = getTokenizationStartIndex();
    const exportData = tableData.map((rowData, rowIndex) => {
        // Для строк до стартовой - использовать исходные значения
        if (rowIndex < startRow) {
            return rowData.map(cellInfo => cellInfo.original);
        }
        // Для остальных - токенизированные
        return rowData.map(cellInfo => {
            if (cellInfo.isTokenized && cellInfo.tokenized) {
                return cellInfo.tokenized;
            }
            return cellInfo.original;
        });
    });
    
    // Конвертировать данные в CSV
    const csv = exportData.map(row => {
        return row.map(cell => {
            const str = cell.toString();
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(',');
    }).join('\n');
    
    // Добавить BOM для корректного отображения кириллицы
    const bom = '\ufeff';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportId}_Таблица_${dateTime}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    // Установить флаг экспорта таблицы
    tableExported = true;
}

// Скачать XLSX
function downloadXLSX() {
    if (tableData.length === 0) return;
    
    recalculateTokenizationStartRow();
    const exportId = generateExportId();
    const dateTime = formatDateTimeForFilename();
    
    // Получить данные для экспорта (токенизированные значения)
    const startRow = getTokenizationStartIndex();
    const exportData = tableData.map((rowData, rowIndex) => {
        // Для строк до стартовой - использовать исходные значения
        if (rowIndex < startRow) {
            return rowData.map(cellInfo => cellInfo.original);
        }
        // Для остальных - токенизированные
        return rowData.map(cellInfo => {
            if (cellInfo.isTokenized && cellInfo.tokenized) {
                return cellInfo.tokenized;
            }
            return cellInfo.original;
        });
    });
    
    // Создать новую книгу
    const wb = XLSX.utils.book_new();
    
    // Конвертировать данные в рабочий лист
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    
    // Добавить лист в книгу
    XLSX.utils.book_append_sheet(wb, ws, 'Tokenized');
    
    // Сохранить файл
    XLSX.writeFile(wb, `${exportId}_Таблица_${dateTime}.xlsx`);
    
    // Установить флаг экспорта таблицы
    tableExported = true;
}

// Скачать JSON-словарь
function downloadJSON() {
    recalculateTokenizationStartRow();
    const exportId = generateExportId();
    const dateTime = formatDateTimeForFilename();
    
    // Собрать только те токены, которые используются в экспортируемых данных
    const startRow = getTokenizationStartIndex();
    const usedTokens = new Set();
    
    tableData.forEach((rowData, rowIndex) => {
        // Учитываем только строки начиная со стартовой
        if (rowIndex >= startRow) {
            rowData.forEach(cellInfo => {
                if (cellInfo.isTokenized && cellInfo.tokenized) {
                    usedTokens.add(cellInfo.tokenized);
                }
            });
        }
    });
    
    const dict = {};
    usedTokens.forEach(token => {
        const original = reverseDictionary.get(token);
        if (original !== undefined) {
            dict[token] = original;
        }
    });
    
    const json = JSON.stringify(dict, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportId}_Словарь_${dateTime}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    // Установить флаг экспорта словаря
    dictionaryExported = true;
}

// Промпт для нейросети
function togglePromptSection(button) {
    const section = document.getElementById('promptSection');
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        button.textContent = 'Свернуть';
    } else {
        section.style.display = 'none';
        button.textContent = 'Развернуть';
    }
}

function copyPromptText(button) {
    const promptElement = document.getElementById('promptTextarea');
    const text = promptElement.textContent || promptElement.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Скопировано!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    }).catch(err => {
        // Fallback для старых браузеров
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            const originalText = button.textContent;
            button.textContent = 'Скопировано!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        } catch (err) {
            alert('Не удалось скопировать текст');
        }
        document.body.removeChild(textArea);
    });
}

// Импорт JSON-словаря
document.getElementById('jsonInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Показать имя файла
    document.getElementById('jsonFileName').textContent = file.name;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const dict = JSON.parse(e.target.result);
            currentDictionary.clear();
            
            Object.keys(dict).forEach(token => {
                currentDictionary.set(token, dict[token]);
            });
            
            // Обновить детокенизацию если текст уже есть
            if (document.getElementById('responseTextarea').value.trim()) {
                processDetokenization();
            }
        } catch (error) {
            alert('Ошибка при загрузке JSON-словаря: ' + error.message);
        }
    };
    reader.readAsText(file);
});

// Обработка текста для детокенизации
document.getElementById('responseTextarea').addEventListener('input', processDetokenization);

function processDetokenization() {
    const text = document.getElementById('responseTextarea').value;
    const tokensListContainer = document.getElementById('tokensList');
    const detokenizedTextContainer = document.getElementById('detokenizedText');
    const statsSummary = document.getElementById('statsSummary');
    
    // Найти все токены вида [[...]]
    const tokenRegex = /\[\[([^\]]+)\]\]/g;
    const foundTokens = new Map(); // token -> count
    const tokenPositions = []; // для подсветки в сыром тексте
    
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const token = match[0]; // Полный токен с [[ и ]]
        foundTokens.set(token, (foundTokens.get(token) || 0) + 1);
        tokenPositions.push({
            token: token,
            start: match.index,
            end: match.index + token.length,
            isFound: currentDictionary.has(token)
        });
    }
    
    // Статистика
    const totalTokens = Array.from(foundTokens.values()).reduce((sum, count) => sum + count, 0);
    const uniqueTokens = foundTokens.size;
    let foundCount = 0;
    let notFoundCount = 0;
    foundTokens.forEach((count, token) => {
        if (currentDictionary.has(token)) {
            foundCount += count;
        } else {
            notFoundCount += count;
        }
    });
    
    statsSummary.innerHTML = `
        <div>Длина текста: ${text.length} символов</div>
        <div>Найдено токенов: ${totalTokens} (уникальных: ${uniqueTokens})</div>
        <div>Распознано: ${foundCount} | Не распознано: ${notFoundCount}</div>
    `;
    
    // Отобразить список токенов
    tokensListContainer.innerHTML = '';
    
    if (foundTokens.size === 0) {
        tokensListContainer.innerHTML = '<p style="color: #666; font-size: 12px;">Токены не найдены</p>';
        detokenizedTextContainer.innerHTML = escapeHtml(text);
        return;
    }
    
    foundTokens.forEach((count, token) => {
        const isFound = currentDictionary.has(token);
        const item = document.createElement('div');
        item.className = `token-item ${isFound ? 'found' : 'not-found'}`;
        
        const info = document.createElement('div');
        info.className = 'token-info';
        
        const tokenSpan = document.createElement('span');
        tokenSpan.textContent = token;
        tokenSpan.style.fontWeight = 'bold';
        tokenSpan.className = 'token-value';
        
        // Добавляем tooltip
        if (isFound) {
            const originalValue = currentDictionary.get(token);
            tokenSpan.title = originalValue;
            tokenSpan.className += ' token-with-tooltip';
        } else {
            tokenSpan.title = 'Не найдено в словаре';
            tokenSpan.className += ' token-not-found';
        }
        
        const countSpan = document.createElement('span');
        countSpan.className = 'token-count';
        countSpan.textContent = `×${count}`;
        
        const statusSpan = document.createElement('span');
        statusSpan.className = `token-status ${isFound ? 'found' : 'not-found'}`;
        statusSpan.textContent = isFound ? 'Найдено в словаре' : 'Не найдено в словаре';
        
        info.appendChild(tokenSpan);
        info.appendChild(countSpan);
        info.appendChild(statusSpan);
        item.appendChild(info);
        
        tokensListContainer.appendChild(item);
    });
    
    // Детокенизировать текст с подсветкой замен
    // Сортируем позиции по порядку
    const sortedPositions = [...tokenPositions].sort((a, b) => a.start - b.start);
    
    // Строим детокенизированный текст с подсветкой
    let highlightedText = '';
    let lastIndex = 0;
    
    sortedPositions.forEach(pos => {
        // Текст до токена
        highlightedText += escapeHtml(text.substring(lastIndex, pos.start));
        
        if (currentDictionary.has(pos.token)) {
            // Токен найден - заменяем и подсвечиваем
            const original = currentDictionary.get(pos.token);
            highlightedText += `<span class="token-replaced">${escapeHtml(original)}</span>`;
        } else {
            // Токен не найден - оставляем как есть
            highlightedText += escapeHtml(pos.token);
        }
        
        lastIndex = pos.end;
    });
    
    // Остаток текста после последнего токена
    highlightedText += escapeHtml(text.substring(lastIndex));
    
    detokenizedTextContainer.innerHTML = highlightedText;
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Экранирование спецсимволов для regex
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Копирование детокенизированного текста
function copyDetokenizedText(button) {
    const container = document.getElementById('detokenizedText');
    const text = container.textContent || container.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Скопировано!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    }).catch(err => {
        alert('Не удалось скопировать текст');
    });
}

// Инициализация обработчиков при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Закрытие модального окна при клике вне его
    const modal = document.getElementById('clearModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeClearModal();
            }
        });
    }

    updateViewModeAvailability();
});
