// Глобальные переменные
let workbook = null;
let currentSheet = null;
let tableData = []; // Массив объектов: {original: value, tokenized: value|null, isTokenized: boolean} для каждой ячейки
let tokenDictionary = new Map(); // original -> token
let reverseDictionary = new Map(); // token -> original
let currentDictionary = new Map(); // для детокенизации
let selectedColumns = new Set(); // выбранные столбцы для токенизации (жёлтые)
let tokenizedColumns = new Set(); // токенизированные столбцы (зелёные)
let viewMode = 'tokenized'; // 'tokenized', 'original', 'both'
let hasTokenizedData = false; // есть ли токенизированные данные

// Загрузка файла
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        workbook = XLSX.read(data, {type: 'array'});
        
        // Показать выбор листа
        const sheetNames = workbook.SheetNames;
        const sheetSelect = document.getElementById('sheetSelect');
        const sheetSelectionWrapper = document.getElementById('sheetSelectionWrapper');
        sheetSelect.innerHTML = '';
        
        if (sheetNames.length > 1) {
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
                document.getElementById('tableSection').style.display = 'none';
                document.getElementById('viewModeWrapper').style.display = 'none';
                document.getElementById('downloadSection').style.display = 'none';
            };
        } else {
            sheetSelectionWrapper.style.display = 'none';
        }
        
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
    viewMode = 'tokenized';
    document.getElementById('viewModeWrapper').style.display = 'none';
    document.getElementById('downloadSection').style.display = 'none';
    
    // Построить таблицу
    displayTable();
    document.getElementById('tableSection').style.display = 'block';
}

// Очистка всего состояния
function clearAll() {
    workbook = null;
    currentSheet = null;
    tableData = [];
    tokenDictionary.clear();
    reverseDictionary.clear();
    currentDictionary.clear();
    selectedColumns.clear();
    tokenizedColumns.clear();
    hasTokenizedData = false;
    viewMode = 'tokenized';
    
    // Очистить UI
    document.getElementById('fileInput').value = '';
    document.getElementById('sheetSelectionWrapper').style.display = 'none';
    document.getElementById('clearButton').style.display = 'none';
    document.getElementById('recognizeButton').style.display = 'none';
    document.getElementById('tableSection').style.display = 'none';
    document.getElementById('viewModeWrapper').style.display = 'none';
    document.getElementById('dataTable').innerHTML = '';
    document.getElementById('downloadSection').style.display = 'none';
    
    // Очистить детокенизацию
    document.getElementById('jsonInput').value = '';
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
    
    const maxCols = tableData[0].length;
    
    // Создать заголовки с чекбоксами
    const headerRow = document.createElement('tr');
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        
        // Определить класс цвета столбца
        if (tokenizedColumns.has(i)) {
            th.className = 'column-tokenized';
        } else if (selectedColumns.has(i)) {
            th.className = 'column-selected';
        }
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'column-checkbox';
        checkbox.value = i;
        checkbox.checked = selectedColumns.has(i) || tokenizedColumns.has(i);
        checkbox.disabled = tokenizedColumns.has(i); // Отключить чекбоксы для токенизированных столбцов
        checkbox.addEventListener('change', function() {
            if (!this.disabled) {
                toggleColumnSelection(parseInt(this.value));
            }
        });
        
        th.appendChild(checkbox);
        
        const label = document.createTextNode(` Столбец ${i + 1}`);
        th.appendChild(label);
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    tableData.forEach((rowData, rowIndex) => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            const cellInfo = rowData[i];
            
            // Определить класс цвета столбца
            let cellClasses = [];
            if (tokenizedColumns.has(i)) {
                cellClasses.push('column-tokenized');
            } else if (selectedColumns.has(i)) {
                cellClasses.push('column-selected');
            }
            
            // Отобразить значение в зависимости от режима просмотра
            if (!cellInfo.isTokenized || !hasTokenizedData) {
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
        table.appendChild(tr);
    });
}

// Переключение выбора столбца
function toggleColumnSelection(colIndex) {
    if (tokenizedColumns.has(colIndex)) {
        return; // Нельзя снять выбор с токенизированного столбца
    }
    
    if (selectedColumns.has(colIndex)) {
        selectedColumns.delete(colIndex);
    } else {
        selectedColumns.add(colIndex);
    }
    
    displayTable();
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
        });
        
        // Переместить столбец из selectedColumns в tokenizedColumns
        tokenizedColumns.add(colIndex);
        selectedColumns.delete(colIndex);
    });
    
    hasTokenizedData = true;
    
    // Показать переключатель режимов после первой токенизации
    if (document.getElementById('viewModeWrapper').style.display === 'none') {
        document.getElementById('viewModeWrapper').style.display = 'block';
        document.getElementById('downloadSection').style.display = 'block';
    }
    
    // Обновить отображение таблицы
    displayTable();
}

// Обновление режима отображения таблицы
function updateTableView() {
    const select = document.getElementById('viewModeSelect');
    viewMode = select.value;
    displayTable();
}

// Скачать CSV
function downloadCSV() {
    if (tableData.length === 0) return;
    
    // Получить данные для экспорта (токенизированные значения)
    const exportData = tableData.map(rowData => {
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
    a.download = 'tokenized.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Скачать XLSX
function downloadXLSX() {
    if (tableData.length === 0) return;
    
    // Получить данные для экспорта (токенизированные значения)
    const exportData = tableData.map(rowData => {
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
    XLSX.writeFile(wb, 'tokenized.xlsx');
}

// Скачать JSON-словарь
function downloadJSON() {
    const dict = {};
    reverseDictionary.forEach((original, token) => {
        dict[token] = original;
    });
    
    const json = JSON.stringify(dict, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dictionary.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Промпт для нейросети
function togglePromptSection(button) {
    const section = document.getElementById('promptSection');
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        button.textContent = '▼ Промпт для нейросети';
    } else {
        section.style.display = 'none';
        button.textContent = '▶ Промпт для нейросети';
    }
}

function copyPromptText(button) {
    const textarea = document.getElementById('promptTextarea');
    const text = textarea.value;
    
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

// Импорт JSON-словаря
document.getElementById('jsonInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
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
        <div>Found: ${foundCount} | Not found: ${notFoundCount}</div>
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
        
        const countSpan = document.createElement('span');
        countSpan.className = 'token-count';
        countSpan.textContent = `×${count}`;
        
        const statusSpan = document.createElement('span');
        statusSpan.className = `token-status ${isFound ? 'found' : 'not-found'}`;
        statusSpan.textContent = isFound ? 'found' : 'not found';
        
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
