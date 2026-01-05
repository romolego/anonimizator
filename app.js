/**
 * Псевдоанонимизация Excel-таблиц
 * Рефакторинг: структурирование кода, безопасность рендера, оптимизация
 */

// =============================================================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ (единый объект)
// =============================================================================

const AppState = {
    // Данные файла
    workbook: null,
    currentSheet: null,
    tableData: [], // Массив строк: [{original, tokenized, isTokenized}, ...]
    
    // Словари токенизации
    tokenDictionary: new Map(),    // original -> token
    reverseDictionary: new Map(),  // token -> original
    currentDictionary: new Map(),  // для детокенизации (из импортированного JSON)
    
    // Состояние выбора столбцов
    selectedColumns: new Set(),    // выбранные для токенизации (жёлтые)
    tokenizedColumns: new Set(),   // уже токенизированные (зелёные)
    
    // Режимы отображения
    viewMode: 'original', // 'tokenized', 'original', 'both'
    hasTokenizedData: false,
    hasAutoSwitchedToTokenView: false,
    
    // Маркер токенизации
    tokenizationStartRow: 1,  // 1-based
    tokenizationMarkerRow: 1, // legacy, совпадает с tokenizationStartRow
    tokenizationEndRow: 1,    // 1-based
    isMarkerEnabled: true,
    
    // Drag маркера
    markerGhostElement: null,
    isMarkerDragging: false,
    markerDragActivated: false,
    markerDragCandidateRow: 1,
    markerDragType: 'start',
    markerDragStart: { x: 0, y: 0 },
    markerDragHighlightedRow: null,
    
    // Экспорт
    currentExportId: null,
    exportDateTime: null,
    tableExported: false,
    dictionaryExported: false,

    // Фильтры токенов
    tokenFilters: {
        found: true,
        notFound: true
    }
};

// Обработчики скролла (хранятся для корректного удаления)
let scrollHandlers = {
    syncTop: null,
    syncBottom: null
};

// =============================================================================
// УТИЛИТЫ
// =============================================================================

/**
 * Безопасное экранирование HTML для предотвращения XSS
 */
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * Генерация криптографически стойкого base64url токена
 */
function generateToken() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    
    let binary = '';
    for (let i = 0; i < array.length; i++) {
        binary += String.fromCharCode(array[i]);
    }
    
    let base64 = btoa(binary);
    // Конвертация в base64url
    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    return `[[${base64}]]`;
}

/**
 * Генерация уникального ID для экспорта (8 символов)
 */
function generateExportId() {
    if (!AppState.currentExportId) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        AppState.currentExportId = id;
    }
    return AppState.currentExportId;
}

/**
 * Форматирование даты/времени для имени файла
 */
function formatDateTimeForFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Получить или зафиксировать метку времени экспорта
 */
function getExportTimestamp() {
    if (!AppState.exportDateTime) {
        AppState.exportDateTime = formatDateTimeForFilename();
    }
    return AppState.exportDateTime;
}

/**
 * Сбросить параметры экспорта
 */
function resetExportContext() {
    AppState.currentExportId = null;
    AppState.exportDateTime = null;
}

/**
 * Единый контекст для файлов экспорта
 */
function getExportContext() {
    return {
        exportId: generateExportId(),
        dateTime: getExportTimestamp()
    };
}

/**
 * Получение элемента DOM с проверкой
 */
function getElement(id) {
    return document.getElementById(id);
}

// =============================================================================
// ЛОГИКА МАРКЕРА ТОКЕНИЗАЦИИ
// =============================================================================

/**
 * Пересчёт стартовой строки токенизации на основе маркера
 */
function recalculateTokenizationStartRow() {
    recalculateTokenizationRange();
}

function recalculateTokenizationRange() {
    const totalRows = AppState.tableData.length;
    const safeTotal = Math.max(1, totalRows);
    AppState.tokenizationStartRow = Math.max(1, Math.min(AppState.tokenizationStartRow, safeTotal));
    AppState.tokenizationEndRow = Math.max(1, Math.min(AppState.tokenizationEndRow, safeTotal));

    if (AppState.tokenizationStartRow > AppState.tokenizationEndRow) {
        const tmp = AppState.tokenizationStartRow;
        AppState.tokenizationStartRow = AppState.tokenizationEndRow;
        AppState.tokenizationEndRow = tmp;
    }
    AppState.tokenizationMarkerRow = AppState.tokenizationStartRow;
}

/**
 * Получить 0-based индекс стартовой строки
 */
function getTokenizationStartIndex() {
    const start = AppState.isMarkerEnabled ? AppState.tokenizationStartRow : 1;
    return Math.max(0, start - 1);
}

/**
 * Получить 0-based индекс конечной строки
 */
function getTokenizationEndIndex() {
    const totalRows = Math.max(1, AppState.tableData.length);
    const end = AppState.isMarkerEnabled ? AppState.tokenizationEndRow : totalRows;
    return Math.max(0, Math.min(totalRows - 1, end - 1));
}

/**
 * Проверка, исключена ли строка из токенизации
 */
function isRowExcludedFromTokenization(rowIndex) {
    return rowIndex < getTokenizationStartIndex() || rowIndex > getTokenizationEndIndex();
}

/**
 * Установка строки маркера
 */
function setMarkerRow(type, rowNumber) {
    const maxRow = Math.max(1, AppState.tableData.length);
    const clamped = Math.max(1, Math.min(rowNumber, maxRow));
    if (type === 'end') {
        AppState.tokenizationEndRow = clamped;
    } else {
        AppState.tokenizationStartRow = clamped;
    }
    recalculateTokenizationRange();
    displayTable();
    setupTokenizationAnchor();
}

/**
 * Переключение активности маркера
 */
function toggleMarkerEnabled() {
    AppState.isMarkerEnabled = !AppState.isMarkerEnabled;
    recalculateTokenizationRange();
    displayTable();
    setupTokenizationAnchor();
}

// =============================================================================
// ЛОГИКА ТОКЕНИЗАЦИИ/ДЕТОКЕНИЗАЦИИ
// =============================================================================

/**
 * Токенизация выбранных столбцов
 * Примечание: токенизируется ВЕСЬ столбец целиком, независимо от положения маркеров.
 * Маркеры влияют только на отображение и экспорт данных.
 */
function tokenizeColumns() {
    if (AppState.selectedColumns.size === 0) {
        alert('Выберите хотя бы один столбец для токенизации');
        return;
    }

    recalculateTokenizationRange();
    
    const hadTokensBefore = AppState.hasTokenizedData && AppState.tokenizedColumns.size > 0;
    let tokenCreated = false;
    
    AppState.selectedColumns.forEach(colIndex => {
        // Токенизация ВСЕХ строк столбца, без учёта маркеров диапазона
        AppState.tableData.forEach((rowData, rowIndex) => {
            const cellInfo = rowData[colIndex];
            if (!cellInfo) return;
            
            const originalValue = cellInfo.original;
            
            // Пропуск пустых значений
            if (originalValue == null || String(originalValue).trim() === '') {
                return;
            }
            
            const valueStr = String(originalValue);
            
            // Использование существующего токена или генерация нового
            if (AppState.tokenDictionary.has(valueStr)) {
                cellInfo.tokenized = AppState.tokenDictionary.get(valueStr);
            } else {
                const token = generateToken();
                AppState.tokenDictionary.set(valueStr, token);
                AppState.reverseDictionary.set(token, valueStr);
                cellInfo.tokenized = token;
            }
            
            cellInfo.isTokenized = true;
            tokenCreated = true;
        });
        
        // Перемещение столбца из selected в tokenized
        AppState.tokenizedColumns.add(colIndex);
        AppState.selectedColumns.delete(colIndex);
    });
    
    AppState.hasTokenizedData = AppState.hasTokenizedData || tokenCreated;
    const hasTokensNow = AppState.hasTokenizedData && AppState.tokenizedColumns.size > 0;
    
    // Сброс ID экспорта при новой токенизации
    resetExportContext();
    
    // Показать секцию экспорта
    const downloadSection = getElement('downloadSection');
    if (downloadSection) {
        downloadSection.style.display = 'block';
    }
    
            updateViewModeAvailability();
    
    // Автопереключение в режим токенов при первой токенизации
    if (!AppState.hasAutoSwitchedToTokenView && !hadTokensBefore && hasTokensNow) {
        AppState.viewMode = 'tokenized';
        const viewSelect = getElement('viewModeSelect');
        if (viewSelect) {
            viewSelect.value = 'tokenized';
        }
        AppState.hasAutoSwitchedToTokenView = true;
    }
    
    displayTable();
    setupTableScrollSync();
}

/**
 * Отмена токенизации столбца
 */
function untokenizeColumn(colIndex) {
    if (!AppState.tokenizedColumns.has(colIndex)) {
        return;
    }
    
    // Сбор токенов для проверки использования
    const tokensToCheck = new Set();
    
    AppState.tableData.forEach((rowData) => {
        const cellInfo = rowData[colIndex];
        if (cellInfo && cellInfo.isTokenized && cellInfo.tokenized) {
            tokensToCheck.add(cellInfo.tokenized);
            cellInfo.tokenized = null;
            cellInfo.isTokenized = false;
        }
    });
    
    // Проверка использования токенов в других столбцах
    tokensToCheck.forEach(token => {
        let tokenStillUsed = false;
        
        outer: for (let r = 0; r < AppState.tableData.length; r++) {
            const rowData = AppState.tableData[r];
            for (let c = 0; c < rowData.length; c++) {
                if (c !== colIndex && rowData[c].tokenized === token) {
                    tokenStillUsed = true;
                    break outer;
                }
            }
        }
        
        // Удаление неиспользуемого токена из словарей
        if (!tokenStillUsed) {
            const originalValue = AppState.reverseDictionary.get(token);
            if (originalValue !== undefined) {
                AppState.tokenDictionary.delete(originalValue);
                AppState.reverseDictionary.delete(token);
            }
        }
    });
    
    AppState.tokenizedColumns.delete(colIndex);
    
    // Сброс состояния если нет токенизированных столбцов
    if (AppState.tokenizedColumns.size === 0) {
        AppState.hasTokenizedData = false;
        const downloadSection = getElement('downloadSection');
        if (downloadSection) {
            downloadSection.style.display = 'none';
        }
        resetExportContext();
        AppState.viewMode = 'original';
        const select = getElement('viewModeSelect');
        if (select) {
            select.value = 'original';
        }
    }

    updateViewModeAvailability();
}

/**
 * Переключение выбора столбца
 */
function toggleColumnSelection(colIndex) {
    if (AppState.tokenizedColumns.has(colIndex)) {
        untokenizeColumn(colIndex);
    } else if (AppState.selectedColumns.has(colIndex)) {
        AppState.selectedColumns.delete(colIndex);
    } else {
        AppState.selectedColumns.add(colIndex);
    }
    
    displayTable();
}

// =============================================================================
// ЛОГИКА ЭКСПОРТА
// =============================================================================

/**
 * Подготовка данных для экспорта
 */
function prepareExportData() {
    recalculateTokenizationRange();
    const startRow = getTokenizationStartIndex();
    const endRow = getTokenizationEndIndex();
    
    return AppState.tableData.map((rowData, rowIndex) => {
        if (rowIndex < startRow || rowIndex > endRow) {
            // Вне диапазона — исходные значения
            return rowData.map(cellInfo => cellInfo.original);
        }
        // Диапазон — токенизированные (если есть)
        return rowData.map(cellInfo => {
            if (cellInfo.isTokenized && cellInfo.tokenized) {
                return cellInfo.tokenized;
            }
            return cellInfo.original;
        });
    });
}

/**
 * Скачать XLSX
 */
function downloadXLSX() {
    if (AppState.tableData.length === 0) return;
    
    const { exportId, dateTime } = getExportContext();
    const exportData = prepareExportData();
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Tokenized');
    XLSX.writeFile(wb, `${exportId}_Таблица_${dateTime}.xlsx`);
    
    AppState.tableExported = true;
}

/**
 * Скачать JSON-словарь
 */
function downloadJSON() {
    recalculateTokenizationRange();
    const { exportId, dateTime } = getExportContext();
    
    // Сбор только используемых токенов
    const startRow = getTokenizationStartIndex();
    const usedTokens = new Set();
    
    const endRow = getTokenizationEndIndex();
    AppState.tableData.forEach((rowData, rowIndex) => {
        if (rowIndex >= startRow && rowIndex <= endRow) {
            rowData.forEach(cellInfo => {
                if (cellInfo.isTokenized && cellInfo.tokenized) {
                    usedTokens.add(cellInfo.tokenized);
                }
            });
        }
    });
    
    const dict = {};
    usedTokens.forEach(token => {
        const original = AppState.reverseDictionary.get(token);
        if (original !== undefined) {
            dict[token] = original;
        }
    });
    
    const json = JSON.stringify(dict, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    downloadBlob(blob, `${exportId}_Словарь_${dateTime}.json`);
    
    AppState.dictionaryExported = true;
}

/**
 * Скачать комплект файлов (CSV + XLSX + JSON-словарь) в ZIP
 */
async function downloadBundleZip() {
    if (AppState.tableData.length === 0) return;
    if (typeof JSZip === 'undefined') {
        alert('Не удалось загрузить библиотеку для формирования ZIP. Проверьте подключение к сети.');
        return;
    }
    
    recalculateTokenizationRange();
    const { exportId, dateTime } = getExportContext();
    const exportData = prepareExportData();

    // XLSX как массив байт
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Tokenized');
    const xlsxArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    // JSON-словарь
    const startRow = getTokenizationStartIndex();
    const usedTokens = new Set();

    const endRow = getTokenizationEndIndex();
    AppState.tableData.forEach((rowData, rowIndex) => {
        if (rowIndex >= startRow && rowIndex <= endRow) {
            rowData.forEach(cellInfo => {
                if (cellInfo.isTokenized && cellInfo.tokenized) {
                    usedTokens.add(cellInfo.tokenized);
                }
            });
        }
    });

    const dict = {};
    usedTokens.forEach(token => {
        const original = AppState.reverseDictionary.get(token);
        if (original !== undefined) {
            dict[token] = original;
        }
    });

    const jsonContent = JSON.stringify(dict, null, 2);

    // Формирование ZIP
    const zip = new JSZip();
    zip.file(`${exportId}_Таблица_${dateTime}.xlsx`, xlsxArray);
    zip.file(`${exportId}_Словарь_${dateTime}.json`, jsonContent);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${exportId}_Комплект_${dateTime}.zip`);

    AppState.tableExported = true;
    AppState.dictionaryExported = true;
}

/**
 * Вспомогательная функция скачивания blob
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// =============================================================================
// UI: ОТОБРАЖЕНИЕ ТАБЛИЦЫ
// =============================================================================

/**
 * Отображение таблицы с использованием DocumentFragment для производительности
 */
function displayTable() {
    const table = getElement('dataTable');
    if (!table) return;
    
    table.innerHTML = '';
    
    if (AppState.tableData.length === 0) return;

    recalculateTokenizationRange();
    clearMarkerDragHighlight();
    
    const maxCols = AppState.tableData[0].length;
    const showTokensView = AppState.viewMode === 'tokenized' || AppState.viewMode === 'both';
    const startIdx = getTokenizationStartIndex();
    const endIdx = getTokenizationEndIndex();
    
    // Создание заголовков
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        
        // Класс цвета столбца
        if (AppState.tokenizedColumns.has(i)) {
            th.className = 'column-tokenized';
        } else if (AppState.selectedColumns.has(i)) {
            th.className = 'column-selected';
        }
        
        // Чекбокс выбора столбца
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'column-checkbox';
        checkbox.dataset.colIndex = i;
        checkbox.checked = AppState.selectedColumns.has(i) || AppState.tokenizedColumns.has(i);
        
        th.appendChild(checkbox);
        th.appendChild(document.createTextNode(` Столбец ${i + 1}`));
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Создание тела таблицы с использованием DocumentFragment
    const tbody = document.createElement('tbody');
    const fragment = document.createDocumentFragment();
    
    AppState.tableData.forEach((rowData, rowIndex) => {
        const tr = document.createElement('tr');
        const isExcludedRow = isRowExcludedFromTokenization(rowIndex);
        
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            const cellInfo = rowData[i];
            
            const cellClasses = [];
            const showColors = true;

            if (showColors && AppState.tokenizedColumns.has(i)) {
                cellClasses.push('column-tokenized');
            } else if (showColors && AppState.selectedColumns.has(i)) {
                cellClasses.push('column-selected');
            }
            
            // Отображение значения в зависимости от режима
            renderCellContent(td, cellInfo, isExcludedRow, cellClasses);
            
            if (cellClasses.length > 0) {
                td.className = cellClasses.join(' ');
            }
            
            tr.appendChild(td);
        }
        fragment.appendChild(tr);
    });
    
    tbody.appendChild(fragment);
    table.appendChild(tbody);
    
    // Отложенное обновление якоря и скролла
    requestAnimationFrame(() => {
        setupTableScrollSync();
        setupTokenizationAnchor();
    });
}

/**
 * Рендеринг содержимого ячейки (вынесено для читаемости)
 */
function renderCellContent(td, cellInfo, isExcludedRow, cellClasses) {
    const showTokensView = AppState.viewMode === 'tokenized' || AppState.viewMode === 'both';
    
    if (isExcludedRow || !cellInfo.isTokenized || !AppState.hasTokenizedData || !showTokensView) {
        // Нетокенизированная ячейка
                td.textContent = cellInfo.original;
                td.title = '';
            } else {
                // Токенизированная ячейка
        if (AppState.viewMode === 'tokenized') {
                    td.textContent = cellInfo.tokenized;
            td.title = cellInfo.original;
                    cellClasses.push('cell-tooltip');
        } else if (AppState.viewMode === 'original') {
                    td.textContent = cellInfo.original;
            td.title = cellInfo.tokenized;
                    cellClasses.push('cell-tooltip');
        } else if (AppState.viewMode === 'both') {
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
}

/**
 * Обновление доступности режимов отображения
 */
function updateViewModeAvailability() {
    const select = getElement('viewModeSelect');
    if (!select) return;

    const tokenizedOption = select.querySelector('option[value="tokenized"]');
    const bothOption = select.querySelector('option[value="both"]');
    const hasTokens = AppState.hasTokenizedData && AppState.tokenizedColumns.size > 0;

    if (tokenizedOption) tokenizedOption.disabled = !hasTokens;
    if (bothOption) bothOption.disabled = !hasTokens;

    if (!hasTokens && (AppState.viewMode === 'tokenized' || AppState.viewMode === 'both')) {
        AppState.viewMode = 'original';
        select.value = 'original';
    }
}

/**
 * Обновление режима отображения таблицы
 */
function updateTableView() {
    const select = getElement('viewModeSelect');
    if (select) {
        AppState.viewMode = select.value;
    }
    displayTable();
}

/**
 * Обновление размера шрифта таблицы
 */
function updateTableFontSize() {
    const select = getElement('fontSizeSelect');
    const table = getElement('dataTable');
    if (!select || !table) return;
    
    const fontSize = select.value;
    const tableContainer = table.closest('.table-wrapper');
    if (!tableContainer) return;
    
    // Удаление всех классов размера шрифта
    const sizeClasses = ['table-font-size-10px', 'table-font-size-12px', 
                         'table-font-size-14px', 'table-font-size-16px', 
                         'table-font-size-18px'];
    sizeClasses.forEach(cls => tableContainer.classList.remove(cls));
    
    // Добавление нового класса
    tableContainer.classList.add(`table-font-size-${fontSize.replace('px', 'px')}`);
    
    // Прямое применение к элементам таблицы
    table.style.fontSize = fontSize;
    const allCells = table.querySelectorAll('th, td');
    allCells.forEach(cell => {
        cell.style.fontSize = fontSize;
    });

    setupTokenizationAnchor();
}

// =============================================================================
// UI: СИНХРОНИЗАЦИЯ СКРОЛЛА
// =============================================================================

/**
 * Настройка синхронизации горизонтального скролла таблицы
 */
function setupTableScrollSync() {
    const tableContainer = getElement('tableContainer');
    const tableScrollTop = getElement('tableScrollTop');
    const table = getElement('dataTable');
    
    if (!tableContainer || !tableScrollTop || !table) return;
    
    const needsScroll = table.scrollWidth > tableContainer.clientWidth;
    
    if (needsScroll) {
        tableScrollTop.style.display = 'block';
        
        // Удаление старых обработчиков
        if (scrollHandlers.syncTop) {
            tableContainer.removeEventListener('scroll', scrollHandlers.syncTop);
        }
        if (scrollHandlers.syncBottom) {
            tableScrollTop.removeEventListener('scroll', scrollHandlers.syncBottom);
        }
        
        // Новые обработчики
        scrollHandlers.syncTop = function() {
            if (tableScrollTop.scrollLeft !== tableContainer.scrollLeft) {
                tableScrollTop.scrollLeft = tableContainer.scrollLeft;
            }
        };
        
        scrollHandlers.syncBottom = function() {
            if (tableContainer.scrollLeft !== tableScrollTop.scrollLeft) {
                tableContainer.scrollLeft = tableScrollTop.scrollLeft;
            }
        };
        
        // Создание элемента для прокрутки
        const scrollWidth = table.scrollWidth;
        tableScrollTop.style.width = '100%';
        tableScrollTop.innerHTML = '';
        
        const scrollContent = document.createElement('div');
        scrollContent.style.width = scrollWidth + 'px';
        scrollContent.style.height = '1px';
        tableScrollTop.appendChild(scrollContent);
        
        tableContainer.addEventListener('scroll', scrollHandlers.syncTop);
        tableScrollTop.addEventListener('scroll', scrollHandlers.syncBottom);
    } else {
        tableScrollTop.style.display = 'none';
    }
}

// =============================================================================
// UI: МАРКЕР ТОКЕНИЗАЦИИ (якорь)
// =============================================================================

/**
 * Настройка визуального якоря токенизации
 */
function setupTokenizationAnchor() {
    const gutter = getElement('tableAnchorGutter');
    const table = getElement('dataTable');
    const tableContainer = getElement('tableContainer');
    
    if (!gutter || !table || AppState.tableData.length === 0) {
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

    let markerRowElementStart = null;
    let markerRowElementEnd = null;

    dataRows.forEach((rowEl, index) => {
        const anchorRow = document.createElement('div');
        anchorRow.className = 'table-anchor-row';
        anchorRow.style.height = `${rowEl.offsetHeight || 30}px`;

        const rowNumber = index + 1;
        if (rowNumber === AppState.tokenizationStartRow) {
            const dotStart = document.createElement('div');
            dotStart.className = 'anchor-dot active anchor-start';
            if (!AppState.isMarkerEnabled) {
                dotStart.classList.add('disabled');
            }
            dotStart.title = AppState.isMarkerEnabled ? 'Начало диапазона токенизации' : 'Маркер выключен';
            registerMarkerInteractions(dotStart, anchorRow, 'start');
            anchorRow.appendChild(dotStart);
            markerRowElementStart = anchorRow;
        }
        if (rowNumber === AppState.tokenizationEndRow) {
            const dotEnd = document.createElement('div');
            dotEnd.className = 'anchor-dot active anchor-end';
            if (!AppState.isMarkerEnabled) {
                dotEnd.classList.add('disabled');
            }
            dotEnd.title = AppState.isMarkerEnabled ? 'Конец диапазона токенизации' : 'Маркер выключен';
            registerMarkerInteractions(dotEnd, anchorRow, 'end');
            anchorRow.appendChild(dotEnd);
            markerRowElementEnd = anchorRow;
        }

        if (rowNumber >= AppState.tokenizationStartRow && rowNumber <= AppState.tokenizationEndRow) {
            anchorRow.classList.add('range-fill');
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

    if (!markerRowElementStart && !markerRowElementEnd) {
        clearMarkerGhost();
    }
}

/**
 * Регистрация обработчиков взаимодействия с маркером
 */
function registerMarkerInteractions(dotElement, rowElement, type = 'start') {
    if (!dotElement || !rowElement) return;

    dotElement.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        startMarkerDrag(e, rowElement, type);
    });
}

/**
 * Начало перетаскивания маркера
 */
function startMarkerDrag(e, rowElement, type = 'start') {
    AppState.isMarkerDragging = true;
    AppState.markerDragActivated = false;
    AppState.markerDragCandidateRow = type === 'start' ? AppState.tokenizationStartRow : AppState.tokenizationEndRow;
    AppState.markerDragType = type;
    AppState.markerDragStart = { x: e.clientX, y: e.clientY };

    clearMarkerDragHighlight();

    document.addEventListener('mousemove', onMarkerDragMove);
    document.addEventListener('mouseup', endMarkerDrag);
    document.addEventListener('mouseleave', endMarkerDrag);

    const dot = rowElement.querySelector('.anchor-dot');
    if (dot) {
        dot.classList.add('dragging', 'drag-hidden');
    }
}

/**
 * Обработка движения при перетаскивании маркера
 */
function onMarkerDragMove(e) {
    if (!AppState.isMarkerDragging) return;

    const dx = e.clientX - AppState.markerDragStart.x;
    const dy = e.clientY - AppState.markerDragStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (!AppState.markerDragActivated && distance > 3) {
        AppState.markerDragActivated = true;
    }
    if (!AppState.markerDragActivated) return;

    const gutter = getElement('tableAnchorGutter');
    if (!gutter) return;
    
    const rows = gutter.querySelectorAll('.table-anchor-row');
    if (!rows.length) return;

    const candidate = resolveMarkerRowByPointer(e.clientY, rows, gutter);
    if (candidate !== null) {
        AppState.markerDragCandidateRow = candidate;
        applyMarkerDragHighlight(candidate, AppState.markerDragType);
    }

    handleMarkerAutoScroll(e.clientY, gutter);
}

/**
 * Завершение перетаскивания маркера
 */
function endMarkerDrag() {
    if (!AppState.isMarkerDragging) return;

    document.removeEventListener('mousemove', onMarkerDragMove);
    document.removeEventListener('mouseup', endMarkerDrag);
    document.removeEventListener('mouseleave', endMarkerDrag);

    const gutter = getElement('tableAnchorGutter');
    if (gutter) {
        const activeDot = gutter.querySelector('.anchor-dot.dragging');
        if (activeDot) {
            activeDot.classList.remove('dragging', 'drag-hidden');
        }
    }

    const wasActiveDrag = AppState.markerDragActivated;
    const candidateRow = AppState.markerDragCandidateRow;
    const dragType = AppState.markerDragType;
    
    AppState.isMarkerDragging = false;
    AppState.markerDragActivated = false;

    if (wasActiveDrag) {
        clearMarkerDragHighlight();
        clearMarkerGhost();
        setMarkerRow(dragType, candidateRow);
    } else {
        // Клик без drag — переключение маркера
        toggleMarkerEnabled();
        clearMarkerGhost();
        setupTokenizationAnchor();
    }
}

/**
 * Определение строки маркера по позиции указателя
 */
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
    
    if (candidate === null) return 1;
    
    const total = Math.max(1, rows.length);
    return Math.max(1, Math.min(candidate, total));
}

/**
 * Очистка подсветки при перетаскивании
 */
function clearMarkerDragHighlight() {
    const gutter = getElement('tableAnchorGutter');
    const table = getElement('dataTable');
    
    const gutterRows = gutter ? gutter.querySelectorAll('.table-anchor-row') : [];
    const tableRows = table ? table.querySelectorAll('tbody tr') : [];

    if (AppState.markerDragHighlightedRow !== null) {
        const idx = AppState.markerDragHighlightedRow - 1;
        if (gutterRows[idx]) gutterRows[idx].classList.remove('drag-hover');
        if (tableRows[idx]) tableRows[idx].classList.remove('drag-hover');
    } else {
        if (gutter) {
            gutter.querySelectorAll('.table-anchor-row.drag-hover').forEach(el => el.classList.remove('drag-hover'));
        }
        if (table) {
            table.querySelectorAll('tbody tr.drag-hover').forEach(el => el.classList.remove('drag-hover'));
        }
    }

    AppState.markerDragHighlightedRow = null;
    clearMarkerGhost();
}

/**
 * Применение подсветки при перетаскивании
 */
function applyMarkerDragHighlight(rowNumber, type = 'start') {
    const gutter = getElement('tableAnchorGutter');
    const table = getElement('dataTable');
    if (!gutter || !table) return;

    if (AppState.markerDragHighlightedRow === rowNumber) {
        return;
    }

    const gutterRows = gutter.querySelectorAll('.table-anchor-row');
    const tableRows = table.querySelectorAll('tbody tr');

    if (AppState.markerDragHighlightedRow !== null) {
        const prevIdx = AppState.markerDragHighlightedRow - 1;
        if (gutterRows[prevIdx]) gutterRows[prevIdx].classList.remove('drag-hover');
        if (tableRows[prevIdx]) tableRows[prevIdx].classList.remove('drag-hover');
    }

    const targetIdx = rowNumber - 1;
    if (gutterRows[targetIdx]) {
        gutterRows[targetIdx].classList.add('drag-hover');
    }
    if (tableRows[targetIdx]) {
        tableRows[targetIdx].classList.add('drag-hover');
    }

    showMarkerGhost(rowNumber, type);
    AppState.markerDragHighlightedRow = rowNumber;
}

/**
 * Автоскролл при перетаскивании к краям
 */
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

/**
 * Показ ghost-элемента маркера
 */
function showMarkerGhost(rowNumber, type = 'start') {
    const gutter = getElement('tableAnchorGutter');
    if (!gutter) return;
    
    const gutterRows = gutter.querySelectorAll('.table-anchor-row');
    const targetRow = gutterRows[rowNumber - 1];
    if (!targetRow) return;

    if (!AppState.markerGhostElement) {
        AppState.markerGhostElement = document.createElement('div');
    }

    AppState.markerGhostElement.className = `anchor-dot drag-ghost ${type === 'end' ? 'anchor-end' : 'anchor-start'}`;

    if (AppState.markerGhostElement.parentElement !== targetRow) {
        AppState.markerGhostElement.remove();
        targetRow.appendChild(AppState.markerGhostElement);
    }
}

/**
 * Очистка ghost-элемента маркера
 */
function clearMarkerGhost() {
    if (AppState.markerGhostElement && AppState.markerGhostElement.parentElement) {
        AppState.markerGhostElement.parentElement.removeChild(AppState.markerGhostElement);
    }
}

// =============================================================================
// UI: ДЕТОКЕНИЗАЦИЯ
// =============================================================================

/**
 * Обработка текста для детокенизации
 */
function processDetokenization() {
    const textarea = getElement('responseTextarea');
    const tokensListContainer = getElement('tokensList');
    const detokenizedTextContainer = getElement('detokenizedText');
    const statsSummary = getElement('statsSummary');
    
    if (!textarea || !tokensListContainer || !detokenizedTextContainer || !statsSummary) return;
    
    const text = textarea.value;
    
    // Поиск всех токенов вида [[...]]
    const tokenRegex = /\[\[([^\]]+)\]\]/g;
    const foundTokens = new Map(); // token -> count
    const tokenPositions = [];
    
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const token = match[0];
        foundTokens.set(token, (foundTokens.get(token) || 0) + 1);
        tokenPositions.push({
            token: token,
            start: match.index,
            end: match.index + token.length,
            isFound: AppState.currentDictionary.has(token)
        });
    }
    
    // Статистика (безопасный рендер)
    const totalTokens = Array.from(foundTokens.values()).reduce((sum, count) => sum + count, 0);
    const uniqueTokens = foundTokens.size;
    let foundCount = 0;
    let notFoundCount = 0;
    
    foundTokens.forEach((count, token) => {
        if (AppState.currentDictionary.has(token)) {
            foundCount += count;
            } else {
            notFoundCount += count;
        }
    });
    
    // Безопасный рендер статистики
    statsSummary.innerHTML = '';
    const statsFragment = document.createDocumentFragment();
    
    const stat1 = document.createElement('div');
    stat1.textContent = `Длина текста: ${text.length} символов`;
    statsFragment.appendChild(stat1);
    
    const stat2 = document.createElement('div');
    stat2.textContent = `Найдено токенов: ${totalTokens} (уникальных: ${uniqueTokens})`;
    statsFragment.appendChild(stat2);
    
    const stat3 = document.createElement('div');
    stat3.textContent = `Распознано: ${foundCount} | Не распознано: ${notFoundCount}`;
    statsFragment.appendChild(stat3);
    
    statsSummary.appendChild(statsFragment);
    const foundCounterEl = getElement('tokenCountFound');
    const notFoundCounterEl = getElement('tokenCountNotFound');
    if (foundCounterEl) foundCounterEl.textContent = foundCount;
    if (notFoundCounterEl) notFoundCounterEl.textContent = notFoundCount;
    
    // Отображение списка токенов
    tokensListContainer.innerHTML = '';
    
    if (foundTokens.size === 0) {
        const noTokensMsg = document.createElement('p');
        noTokensMsg.style.color = '#666';
        noTokensMsg.style.fontSize = '12px';
        noTokensMsg.textContent = 'Токены не найдены';
        tokensListContainer.appendChild(noTokensMsg);
        detokenizedTextContainer.textContent = text;
        renderResponseHighlight(text, []);
        return;
    }
    
    const tokensFragment = document.createDocumentFragment();
    let renderedItems = 0;
    
    foundTokens.forEach((count, token) => {
        const isFound = AppState.currentDictionary.has(token);
        const typeAllowed = isFound ? AppState.tokenFilters.found : AppState.tokenFilters.notFound;
        if (!typeAllowed) {
            return;
        }

        const item = document.createElement('div');
        item.className = `token-item ${isFound ? 'found' : 'not-found'}`;
        
        const info = document.createElement('div');
        info.className = 'token-info';
        
        const tokenSpan = document.createElement('span');
        tokenSpan.textContent = token;
        tokenSpan.style.fontWeight = 'bold';
        tokenSpan.className = 'token-value';
        
        if (isFound) {
            const originalValue = AppState.currentDictionary.get(token);
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
        
        tokensFragment.appendChild(item);
        renderedItems++;
    });
    
    if (renderedItems === 0) {
        const filteredMsg = document.createElement('p');
        filteredMsg.style.color = '#666';
        filteredMsg.style.fontSize = '12px';
        filteredMsg.textContent = 'Нет токенов для выбранных фильтров';
        tokensListContainer.appendChild(filteredMsg);
    } else {
        tokensListContainer.appendChild(tokensFragment);
    }
    
    // Детокенизированный текст с подсветкой замен
    const sortedPositions = [...tokenPositions].sort((a, b) => a.start - b.start);
    renderResponseHighlight(text, sortedPositions);
    
    detokenizedTextContainer.innerHTML = '';
    const resultFragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    sortedPositions.forEach(pos => {
        // Текст до токена
        if (pos.start > lastIndex) {
            resultFragment.appendChild(document.createTextNode(text.substring(lastIndex, pos.start)));
        }
        
        if (AppState.currentDictionary.has(pos.token)) {
            // Токен найден — заменяем и подсвечиваем
            const original = AppState.currentDictionary.get(pos.token);
            const span = document.createElement('span');
            span.className = 'token-replaced';
            span.textContent = original;
            resultFragment.appendChild(span);
        } else {
            // Токен не найден — выделяем
            const span = document.createElement('span');
            span.className = 'token-unresolved';
            span.textContent = pos.token;
            resultFragment.appendChild(span);
        }
        
        lastIndex = pos.end;
    });
    
    // Остаток текста после последнего токена
    if (lastIndex < text.length) {
        resultFragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
    
    detokenizedTextContainer.appendChild(resultFragment);
}

// =============================================================================
// UI: МОДАЛЬНЫЕ ОКНА И ПРОЧЕЕ
// =============================================================================

/**
 * Показ модального окна подтверждения очистки
 */
function showClearModal() {
    const modal = getElement('clearModal');
    const warning = getElement('clearModalWarning');
    const message = getElement('clearModalMessage');
    
    if (!modal || !warning || !message) return;
    
    // Предупреждение о словаре
    if (AppState.tableExported && !AppState.dictionaryExported) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
    message.textContent = 'Вы уверены, что хотите очистить все данные?';
    
    modal.classList.add('show');
}

/**
 * Закрытие модального окна
 */
function closeClearModal() {
    const modal = getElement('clearModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

/**
 * Подтверждение очистки
 */
function confirmClear() {
    closeClearModal();
    performClear();
}

/**
 * Вызов очистки (показ модалки)
 */
function clearAll() {
    showClearModal();
}

/**
 * Выполнение полной очистки состояния
 */
function performClear() {
    // Сброс состояния
    AppState.workbook = null;
    AppState.currentSheet = null;
    AppState.tableData = [];
    AppState.tokenDictionary.clear();
    AppState.reverseDictionary.clear();
    AppState.currentDictionary.clear();
    AppState.selectedColumns.clear();
    AppState.tokenizedColumns.clear();
    AppState.hasTokenizedData = false;
    AppState.hasAutoSwitchedToTokenView = false;
    AppState.viewMode = 'original';
    AppState.tokenizationStartRow = 1;
    AppState.tokenizationMarkerRow = 1;
    AppState.tokenizationEndRow = 1;
    AppState.isMarkerEnabled = true;
    resetExportContext();
    AppState.tableExported = false;
    AppState.dictionaryExported = false;
    AppState.tokenFilters = { found: true, notFound: true };
    
    clearMarkerGhost();
    updateViewModeAvailability();
    
    // Очистка UI
    const fileInput = getElement('fileInput');
    if (fileInput) fileInput.value = '';
    
    const sheetSelect = getElement('sheetSelect');
    if (sheetSelect) sheetSelect.innerHTML = '';
    
    const elements = {
        sheetSelectionWrapper: { style: 'display', value: 'none' },
        clearButton: { style: 'display', value: 'none' },
        recognizeButton: { style: 'display', value: 'none' },
        tableSection: { style: 'display', value: 'none' },
        viewModeWrapper: { style: 'display', value: 'none' },
        fontSizeWrapper: { style: 'display', value: 'none' },
        downloadSection: { style: 'display', value: 'none' }
    };
    
    Object.entries(elements).forEach(([id, config]) => {
        const el = getElement(id);
        if (el) el.style[config.style] = config.value;
    });
    
    const dataTable = getElement('dataTable');
    if (dataTable) dataTable.innerHTML = '';
    
    const gutter = getElement('tableAnchorGutter');
    if (gutter) gutter.innerHTML = '';
    
    // Очистка детокенизации
    const detokenizationElements = ['jsonInput', 'responseTextarea'];
    detokenizationElements.forEach(id => {
        const el = getElement(id);
        if (el) el.value = '';
    });
    
    const textElements = ['jsonFileName', 'tokensList', 'detokenizedText', 'statsSummary'];
    textElements.forEach(id => {
        const el = getElement(id);
        if (el) {
            if (id === 'jsonFileName') {
                el.textContent = '';
            } else {
                el.innerHTML = '';
            }
        }
    });
}

/**
 * Универсальный переключатель секций (аккордеон)
 */
function toggleCollapse(sectionId, button, collapsedText = 'Развернуть', expandedText = 'Свернуть') {
    const section = getElement(sectionId);
    if (!section || !button) return;

    const isHidden = section.style.display === 'none' || section.style.display === '';
    section.style.display = isHidden ? 'block' : 'none';
    button.textContent = isHidden ? expandedText : collapsedText;
    button.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
}

/**
 * Переключение секции промпта
 */
function togglePromptSection(button) {
    toggleCollapse('promptSection', button);
}

/**
 * Копирование текста промпта
 */
function copyPromptText(button) {
    const promptElement = getElement('promptTextarea');
    if (!promptElement) return;
    
    const text = promptElement.textContent || promptElement.innerText;
    copyToClipboard(text, button);
}

/**
 * Копирование детокенизированного текста
 */
function copyDetokenizedText(button) {
    const container = getElement('detokenizedText');
    if (!container) return;
    
    const text = container.textContent || container.innerText;
    copyToClipboard(text, button);
}

/**
 * Переключение фильтра токенов (найденные/ненайденные)
 */
function toggleTokenFilter(type, checkbox) {
    if (!checkbox) return;
    if (type === 'found') {
        AppState.tokenFilters.found = checkbox.checked;
    } else if (type === 'notFound') {
        AppState.tokenFilters.notFound = checkbox.checked;
    }
    processDetokenization();
}

/**
 * Отрисовка подсветки токенов в сыром ответе
 */
function renderResponseHighlight(text, tokenPositions) {
    const highlightEl = getElement('responseHighlight');
    const textarea = getElement('responseTextarea');
    if (!highlightEl || !textarea) return;

    const sorted = [...tokenPositions].sort((a, b) => a.start - b.start);
    let lastIndex = 0;
    let html = '';

    sorted.forEach(pos => {
        if (pos.start > lastIndex) {
            html += escapeHtml(text.substring(lastIndex, pos.start));
        }
        const cls = pos.isFound ? 'token-highlight-found' : 'token-highlight-notfound';
        html += `<span class="${cls}">${escapeHtml(text.substring(pos.start, pos.end))}</span>`;
        lastIndex = pos.end;
    });

    if (lastIndex < text.length) {
        html += escapeHtml(text.substring(lastIndex));
    }

    highlightEl.innerHTML = html || '&nbsp;';
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
}

/**
 * Синхронизация скролла подсветки с textarea
 */
function syncResponseHighlightScroll() {
    const highlightEl = getElement('responseHighlight');
    const textarea = getElement('responseTextarea');
    if (!highlightEl || !textarea) return;
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
}

/**
 * Переключение сворачивания детокенизированного ответа
 */
function toggleDetokenizedResult(button) {
    const container = getElement('detokenizedText');
    if (!container || !button) return;

    const isCollapsed = container.classList.contains('result-text-collapsed');
    container.classList.toggle('result-text-collapsed', !isCollapsed);
    container.classList.toggle('result-text-expanded', isCollapsed);
    button.textContent = isCollapsed ? 'Свернуть' : 'Развернуть';
    button.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
}

/**
 * Универсальная функция копирования в буфер обмена
 */
function copyToClipboard(text, button) {
    const originalText = button ? button.textContent : '';
    
    navigator.clipboard.writeText(text).then(() => {
        if (button) {
        button.textContent = 'Скопировано!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
        }
    }).catch(() => {
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
            if (button) {
            button.textContent = 'Скопировано!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
            }
        } catch (err) {
            alert('Не удалось скопировать текст');
        }
        document.body.removeChild(textArea);
    });
}

// =============================================================================
// ЗАГРУЗКА ФАЙЛОВ
// =============================================================================

/**
 * Распознавание данных (построение таблицы)
 */
function recognizeData() {
    if (!AppState.workbook) {
        alert('Сначала выберите файл');
        return;
    }
    
    const sheetSelect = getElement('sheetSelect');
    let sheetIndex = 0;
    if (sheetSelect && sheetSelect.value !== undefined && sheetSelect.value !== '') {
        sheetIndex = parseInt(sheetSelect.value, 10);
    }
    
    AppState.currentSheet = AppState.workbook.Sheets[AppState.workbook.SheetNames[sheetIndex]];
    const rawData = XLSX.utils.sheet_to_json(AppState.currentSheet, { header: 1, defval: '' });
    
    // Обработка пустого листа
    if (rawData.length === 0) {
        alert('Выбранный лист пуст');
        return;
    }
    
    // Инициализация структуры данных
    const maxCols = Math.max(...rawData.map(row => row.length), 0);
    
    if (maxCols === 0) {
        alert('Выбранный лист не содержит данных');
        return;
    }
    
    AppState.tableData = rawData.map(row => {
        const cellData = [];
        for (let i = 0; i < maxCols; i++) {
            const value = row[i] !== undefined ? row[i] : '';
            cellData.push({
                original: value,
                tokenized: null,
                isTokenized: false
            });
        }
        return cellData;
    });
    
    // Сброс состояния
    AppState.selectedColumns.clear();
    AppState.tokenizedColumns.clear();
    AppState.hasTokenizedData = false;
    AppState.hasAutoSwitchedToTokenView = false;
    AppState.viewMode = 'original';
    AppState.tokenizationMarkerRow = 1;
    AppState.tokenizationEndRow = AppState.tableData.length || 1;
    AppState.isMarkerEnabled = true;
    recalculateTokenizationStartRow();
    resetExportContext();
    AppState.tableExported = false;
    AppState.dictionaryExported = false;
    AppState.tokenFilters = { found: true, notFound: true };
    
    const viewModeSelect = getElement('viewModeSelect');
    if (viewModeSelect) {
        viewModeSelect.value = 'original';
    }
    
    // Показ UI элементов
    const uiElements = {
        viewModeWrapper: 'flex',
        fontSizeWrapper: 'flex',
        downloadSection: 'none',
        tableSection: 'block'
    };
    
    Object.entries(uiElements).forEach(([id, display]) => {
        const el = getElement(id);
        if (el) el.style.display = display;
    });
    
    updateViewModeAvailability();
    displayTable();
    setupTableScrollSync();
    setupTokenizationAnchor();
}

/**
 * Обработчик загрузки файла
 */
function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            AppState.workbook = XLSX.read(data, { type: 'array' });
            
            // Проверка на пустую книгу
            if (!AppState.workbook.SheetNames || AppState.workbook.SheetNames.length === 0) {
                alert('Файл не содержит листов');
        return;
    }
    
            // Показать выбор листа
            const sheetNames = AppState.workbook.SheetNames;
            const sheetSelect = getElement('sheetSelect');
            const sheetSelectionWrapper = getElement('sheetSelectionWrapper');
            
            if (sheetSelect) {
                sheetSelect.innerHTML = '';
                sheetNames.forEach((name, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = name;
                    sheetSelect.appendChild(option);
                });
            }
            
            if (sheetSelectionWrapper) {
                sheetSelectionWrapper.style.display = 'flex';
            }
            
            const clearButton = getElement('clearButton');
            const recognizeButton = getElement('recognizeButton');
            
            if (clearButton) clearButton.style.display = 'inline-block';
            if (recognizeButton) recognizeButton.style.display = 'inline-block';
        } catch (error) {
            alert('Ошибка при чтении файла: ' + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Обработчик смены листа
 */
function handleSheetChange() {
    // Сброс состояния при смене листа
    AppState.selectedColumns.clear();
    AppState.tokenizedColumns.clear();
    AppState.tableData = [];
    AppState.hasTokenizedData = false;
    AppState.hasAutoSwitchedToTokenView = false;
    AppState.viewMode = 'original';
    AppState.tokenizationMarkerRow = 1;
    AppState.tokenizationEndRow = 1;
    AppState.isMarkerEnabled = true;
    AppState.tokenizationStartRow = 1;
    resetExportContext();
    AppState.tableExported = false;
    AppState.dictionaryExported = false;
    AppState.tokenFilters = { found: true, notFound: true };
    
    const viewModeSelect = getElement('viewModeSelect');
    if (viewModeSelect) {
        viewModeSelect.value = 'original';
    }
    
    updateViewModeAvailability();
    
    const elementsToHide = ['tableSection', 'viewModeWrapper', 'fontSizeWrapper', 'downloadSection'];
    elementsToHide.forEach(id => {
        const el = getElement(id);
        if (el) el.style.display = 'none';
    });
}

/**
 * Обработчик импорта JSON-словаря
 */
function handleJsonImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const jsonFileName = getElement('jsonFileName');
    if (jsonFileName) {
        jsonFileName.textContent = file.name;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const dict = JSON.parse(e.target.result);
            AppState.currentDictionary.clear();
            
            Object.keys(dict).forEach(token => {
                AppState.currentDictionary.set(token, dict[token]);
            });
            
            // Обновить детокенизацию если текст уже есть
            const responseTextarea = getElement('responseTextarea');
            if (responseTextarea && responseTextarea.value.trim()) {
                processDetokenization();
            }
        } catch (error) {
            alert('Ошибка при загрузке JSON-словаря: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// =============================================================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================================================

/**
 * Делегированный обработчик клика по чекбоксам столбцов
 */
function handleTableClick(e) {
    const checkbox = e.target.closest('.column-checkbox');
    if (checkbox) {
        const colIndex = parseInt(checkbox.dataset.colIndex, 10);
        if (!isNaN(colIndex)) {
            toggleColumnSelection(colIndex);
        }
    }
}

/**
 * Инициализация обработчиков событий
 */
function initEventHandlers() {
    // Загрузка файла
    const fileInput = getElement('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileLoad);
    }
    
    // Смена листа
    const sheetSelect = getElement('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', handleSheetChange);
    }
    
    // Импорт JSON
    const jsonInput = getElement('jsonInput');
    if (jsonInput) {
        jsonInput.addEventListener('change', handleJsonImport);
    }
    
    // Детокенизация
    const responseTextarea = getElement('responseTextarea');
    if (responseTextarea) {
        responseTextarea.addEventListener('input', processDetokenization);
        responseTextarea.addEventListener('scroll', syncResponseHighlightScroll);
    }
    
    // Делегированный обработчик для чекбоксов столбцов (избегаем повторного навешивания)
    const dataTable = getElement('dataTable');
    if (dataTable) {
        dataTable.addEventListener('click', handleTableClick);
    }
    
    // Модальное окно — закрытие по клику вне
    const modal = getElement('clearModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeClearModal();
            }
        });
    }

    updateViewModeAvailability();
}

// Запуск инициализации при загрузке DOM
document.addEventListener('DOMContentLoaded', initEventHandlers);
