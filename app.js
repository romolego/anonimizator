// Глобальные переменные
let workbook = null;
let currentSheet = null;
let originalData = [];
let tokenizedData = [];
let tokenDictionary = new Map(); // original -> token
let reverseDictionary = new Map(); // token -> original
let currentDictionary = new Map(); // для детокенизации
let selectedColumns = new Set(); // выбранные столбцы для токенизации
let scrollSyncEnabled = true; // флаг для предотвращения бесконечного цикла при синхронизации

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
            sheetSelect.onchange = loadSheet;
        } else {
            sheetSelectionWrapper.style.display = 'none';
            loadSheetByIndex(0);
        }
        
        document.getElementById('clearButton').style.display = 'block';
    };
    reader.readAsArrayBuffer(file);
});

// Загрузка листа
function loadSheet(e) {
    const index = parseInt(e.target.value);
    loadSheetByIndex(index);
}

function loadSheetByIndex(index) {
    currentSheet = workbook.Sheets[workbook.SheetNames[index]];
    originalData = XLSX.utils.sheet_to_json(currentSheet, {header: 1, defval: ''});
    
    selectedColumns.clear();
    displayOriginalTable();
    
    // Скрыть результат токенизации
    document.getElementById('tokenizedTableContainer').innerHTML = '<table id="tokenizedTable"></table>';
    document.getElementById('downloadSection').style.display = 'none';
    
    document.getElementById('tablesSection').style.display = 'block';
}

// Очистка всего состояния
function clearAll() {
    workbook = null;
    currentSheet = null;
    originalData = [];
    tokenizedData = [];
    tokenDictionary.clear();
    reverseDictionary.clear();
    selectedColumns.clear();
    
    // Очистить UI
    document.getElementById('fileInput').value = '';
    document.getElementById('sheetSelectionWrapper').style.display = 'none';
    document.getElementById('clearButton').style.display = 'none';
    document.getElementById('tablesSection').style.display = 'none';
    document.getElementById('originalTable').innerHTML = '';
    document.getElementById('tokenizedTable').innerHTML = '';
    document.getElementById('downloadSection').style.display = 'none';
    
    // Очистить детокенизацию
    document.getElementById('jsonInput').value = '';
    document.getElementById('responseTextarea').value = '';
    document.getElementById('tokensList').innerHTML = '';
    document.getElementById('detokenizedText').innerHTML = '';
    document.getElementById('statsSummary').innerHTML = '';
    currentDictionary.clear();
}

// Отображение исходной таблицы с чекбоксами в заголовках
function displayOriginalTable() {
    const table = document.getElementById('originalTable');
    table.innerHTML = '';
    
    if (originalData.length === 0) return;
    
    // Создать заголовки с чекбоксами
    const headerRow = document.createElement('tr');
    const maxCols = Math.max(...originalData.map(row => row.length));
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        th.className = selectedColumns.has(i) ? 'column-selected' : '';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'column-checkbox';
        checkbox.value = i;
        checkbox.checked = selectedColumns.has(i);
        checkbox.addEventListener('change', function() {
            toggleColumnSelection(parseInt(this.value));
        });
        
        th.appendChild(checkbox);
        
        const label = document.createTextNode(` Столбец ${i + 1}`);
        th.appendChild(label);
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    originalData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.className = selectedColumns.has(i) ? 'column-selected' : '';
            td.textContent = row[i] || '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
}

// Переключение выбора столбца
function toggleColumnSelection(colIndex) {
    if (selectedColumns.has(colIndex)) {
        selectedColumns.delete(colIndex);
    } else {
        selectedColumns.add(colIndex);
    }
    
    // Обновить отображение исходной таблицы
    displayOriginalTable();
}

// Настройка синхронизации прокрутки
function setupScrollSync(container1Id, container2Id) {
    const container1 = document.getElementById(container1Id);
    const container2 = document.getElementById(container2Id);
    
    if (!container1 || !container2) return;
    
    // Удалить старые обработчики
    container1.onscroll = null;
    container2.onscroll = null;
    
    container1.onscroll = function() {
        if (!scrollSyncEnabled) return;
        scrollSyncEnabled = false;
        container2.scrollTop = container1.scrollTop;
        container2.scrollLeft = container1.scrollLeft;
        scrollSyncEnabled = true;
    };
    
    container2.onscroll = function() {
        if (!scrollSyncEnabled) return;
        scrollSyncEnabled = false;
        container1.scrollTop = container2.scrollTop;
        container1.scrollLeft = container2.scrollLeft;
        scrollSyncEnabled = true;
    };
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

// Токенизация столбцов
function tokenizeColumns() {
    if (selectedColumns.size === 0) {
        alert('Выберите хотя бы один столбец для токенизации');
        return;
    }
    
    // Сбросить словари
    tokenDictionary.clear();
    reverseDictionary.clear();
    
    // Копировать данные
    tokenizedData = originalData.map(row => [...row]);
    
    // Токенизировать выбранные столбцы
    tokenizedData.forEach((row, rowIndex) => {
        selectedColumns.forEach(colIndex => {
            const originalValue = row[colIndex];
            
            // Пропустить пустые значения
            if (!originalValue || originalValue.toString().trim() === '') {
                return;
            }
            
            const valueStr = originalValue.toString();
            
            // Если значение уже есть в словаре, использовать существующий токен
            if (tokenDictionary.has(valueStr)) {
                row[colIndex] = tokenDictionary.get(valueStr);
            } else {
                // Сгенерировать новый токен
                const token = generateToken();
                tokenDictionary.set(valueStr, token);
                reverseDictionary.set(token, valueStr);
                row[colIndex] = token;
            }
        });
    });
    
    displayTokenizedTable();
    
    // Показать секцию результатов
    document.getElementById('downloadSection').style.display = 'block';
}

// Отображение токенизированной таблицы
function displayTokenizedTable() {
    const table = document.getElementById('tokenizedTable');
    table.innerHTML = '';
    
    if (tokenizedData.length === 0) return;
    
    // Создать заголовки
    const headerRow = document.createElement('tr');
    const maxCols = Math.max(...tokenizedData.map(row => row.length));
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        th.className = selectedColumns.has(i) ? 'column-selected' : '';
        th.textContent = `Столбец ${i + 1}`;
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    tokenizedData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.className = selectedColumns.has(i) ? 'column-selected' : '';
            td.textContent = row[i] || '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
    
    // Настроить синхронизацию прокрутки после создания обеих таблиц
    setupScrollSync('originalTableContainer', 'tokenizedTableContainer');
}

// Скачать CSV
function downloadCSV() {
    if (tokenizedData.length === 0) return;
    
    // Конвертировать данные в CSV
    const csv = tokenizedData.map(row => {
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
    if (tokenizedData.length === 0) return;
    
    // Создать новую книгу
    const wb = XLSX.utils.book_new();
    
    // Конвертировать данные в рабочий лист
    const ws = XLSX.utils.aoa_to_sheet(tokenizedData);
    
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
