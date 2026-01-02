// Глобальные переменные
let workbook = null;
let currentSheet = null;
let originalData = [];
let tokenizedData = [];
let tokenDictionary = new Map(); // original -> token
let reverseDictionary = new Map(); // token -> original
let currentDictionary = new Map(); // для детокенизации
let selectedColumns = new Set(); // выбранные столбцы для токенизации
let syncScrollEnabled = true;

// Очистка всего состояния
function clearAll() {
    workbook = null;
    currentSheet = null;
    originalData = [];
    tokenizedData = [];
    tokenDictionary.clear();
    reverseDictionary.clear();
    currentDictionary.clear();
    selectedColumns.clear();
    
    // Сбросить UI
    document.getElementById('fileInput').value = '';
    document.getElementById('sheetSelectionContainer').style.display = 'none';
    document.getElementById('tablesSection').style.display = 'none';
    document.getElementById('exportSection').style.display = 'none';
    document.getElementById('originalTable').innerHTML = '';
    document.getElementById('tokenizedTable').innerHTML = '';
    document.getElementById('responseTextarea').value = '';
    document.getElementById('tokensList').innerHTML = '';
    document.getElementById('detokenizedText').innerHTML = '';
    document.getElementById('statistics').style.display = 'none';
    document.getElementById('jsonInput').value = '';
}

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
        const sheetContainer = document.getElementById('sheetSelectionContainer');
        
        sheetSelect.innerHTML = '';
        
        if (sheetNames.length > 1) {
            sheetNames.forEach((name, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = name;
                sheetSelect.appendChild(option);
            });
            sheetContainer.style.display = 'flex';
            sheetSelect.onchange = loadSheet;
            loadSheetByIndex(0);
        } else {
            sheetContainer.style.display = 'none';
            loadSheetByIndex(0);
        }
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
    document.getElementById('tablesSection').style.display = 'block';
}

// Отображение исходной таблицы с чекбоксами в заголовках
function displayOriginalTable() {
    const table = document.getElementById('originalTable');
    table.innerHTML = '';
    
    if (originalData.length === 0) return;
    
    const maxCols = Math.max(...originalData.map(row => row.length));
    
    // Создать заголовки с чекбоксами
    const headerRow = document.createElement('tr');
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        th.className = selectedColumns.has(i) ? 'column-selected' : '';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedColumns.has(i);
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                selectedColumns.add(i);
            } else {
                selectedColumns.delete(i);
            }
            updateColumnHighlighting();
        });
        
        const label = document.createElement('label');
        label.textContent = `Столбец ${i + 1}`;
        label.style.cursor = 'pointer';
        label.addEventListener('click', function(e) {
            if (e.target !== checkbox) {
                checkbox.click();
            }
        });
        
        th.appendChild(checkbox);
        th.appendChild(label);
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    originalData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.textContent = row[i] || '';
            td.className = selectedColumns.has(i) ? 'column-selected' : '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
}

// Обновление подсветки столбцов
function updateColumnHighlighting() {
    const table = document.getElementById('originalTable');
    const maxCols = Math.max(...originalData.map(row => row.length));
    
    // Обновить заголовки
    const headerRow = table.querySelector('tr');
    const headers = headerRow.querySelectorAll('th');
    headers.forEach((th, i) => {
        if (selectedColumns.has(i)) {
            th.className = 'column-selected';
            th.querySelector('input[type="checkbox"]').checked = true;
        } else {
            th.className = '';
            th.querySelector('input[type="checkbox"]').checked = false;
        }
    });
    
    // Обновить ячейки
    const rows = table.querySelectorAll('tr');
    rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) return; // пропустить заголовок
        const cells = row.querySelectorAll('td');
        cells.forEach((td, i) => {
            if (selectedColumns.has(i)) {
                td.className = 'column-selected';
            } else {
                td.className = '';
            }
        });
    });
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
    
    // Показать секцию экспорта
    document.getElementById('exportSection').style.display = 'block';
}

// Отображение токенизированной таблицы с подсветкой
function displayTokenizedTable() {
    const table = document.getElementById('tokenizedTable');
    table.innerHTML = '';
    
    if (tokenizedData.length === 0) return;
    
    const maxCols = Math.max(...tokenizedData.map(row => row.length));
    
    // Создать заголовки
    const headerRow = document.createElement('tr');
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        th.textContent = `Столбец ${i + 1}`;
        th.className = selectedColumns.has(i) ? 'column-selected' : '';
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    tokenizedData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.textContent = row[i] || '';
            td.className = selectedColumns.has(i) ? 'column-selected' : '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
    
    // Настроить синхронную прокрутку
    setupSyncScroll();
}

// Настройка синхронной прокрутки
function setupSyncScroll() {
    const originalContainer = document.getElementById('originalTableContainer');
    const tokenizedContainer = document.getElementById('tokenizedTableContainer');
    
    // Удалить старые обработчики
    originalContainer.onscroll = null;
    tokenizedContainer.onscroll = null;
    
    // Синхронизация: оригинал -> токенизированная
    originalContainer.onscroll = function() {
        if (syncScrollEnabled) {
            syncScrollEnabled = false;
            tokenizedContainer.scrollTop = originalContainer.scrollTop;
            tokenizedContainer.scrollLeft = originalContainer.scrollLeft;
            setTimeout(() => { syncScrollEnabled = true; }, 10);
        }
    };
    
    // Синхронизация: токенизированная -> оригинал
    tokenizedContainer.onscroll = function() {
        if (syncScrollEnabled) {
            syncScrollEnabled = false;
            originalContainer.scrollTop = tokenizedContainer.scrollTop;
            originalContainer.scrollLeft = tokenizedContainer.scrollLeft;
            setTimeout(() => { syncScrollEnabled = true; }, 10);
        }
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
    
    // Создать новый workbook
    const wb = XLSX.utils.book_new();
    
    // Конвертировать данные в worksheet
    const ws = XLSX.utils.aoa_to_sheet(tokenizedData);
    
    // Добавить worksheet в workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    // Скачать
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

// Промпт-подсказка
function togglePromptHint(button) {
    const content = document.getElementById('promptHintContent');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        button.textContent = '▼ Промпт для нейросети';
    } else {
        content.style.display = 'none';
        button.textContent = '▶ Промпт для нейросети';
    }
}

function copyPromptHint(button) {
    const text = document.getElementById('promptText').value;
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
    const statisticsContainer = document.getElementById('statistics');
    
    // Найти все токены вида [[...]]
    const tokenRegex = /\[\[([^\]]+)\]\]/g;
    const foundTokens = new Map(); // token -> count
    const tokenPositions = []; // для подсветки в textarea
    
    let match;
    const textCopy = text; // копия для поиска позиций
    while ((match = tokenRegex.exec(textCopy)) !== null) {
        const token = match[0]; // Полный токен с [[ и ]]
        foundTokens.set(token, (foundTokens.get(token) || 0) + 1);
        tokenPositions.push({
            token: token,
            index: match.index,
            length: match[0].length
        });
    }
    
    // Статистика
    let foundCount = 0;
    let notFoundCount = 0;
    foundTokens.forEach((count, token) => {
        if (currentDictionary.has(token)) {
            foundCount++;
        } else {
            notFoundCount++;
        }
    });
    
    const totalOccurrences = Array.from(foundTokens.values()).reduce((a, b) => a + b, 0);
    
    // Обновить статистику
    document.getElementById('textLength').textContent = text.length;
    document.getElementById('totalTokens').textContent = totalOccurrences;
    document.getElementById('uniqueTokens').textContent = foundTokens.size;
    document.getElementById('foundTokens').textContent = foundCount;
    document.getElementById('notFoundTokens').textContent = notFoundCount;
    statisticsContainer.style.display = 'flex';
    
    // Отобразить список токенов
    tokensListContainer.innerHTML = '';
    
    if (foundTokens.size === 0) {
        tokensListContainer.innerHTML = '<p style="color: #666; font-size: 12px;">Токены не найдены</p>';
        detokenizedTextContainer.innerHTML = '';
        statisticsContainer.style.display = 'none';
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
    let detokenizedHTML = '';
    let lastIndex = 0;
    
    // Отсортировать позиции по индексу
    tokenPositions.sort((a, b) => a.index - b.index);
    
    tokenPositions.forEach(pos => {
        // Добавить текст до токена
        if (pos.index > lastIndex) {
            const beforeText = escapeHtml(text.substring(lastIndex, pos.index));
            detokenizedHTML += beforeText;
        }
        
        // Заменить токен
        if (currentDictionary.has(pos.token)) {
            const original = currentDictionary.get(pos.token);
            const escapedOriginal = escapeHtml(original);
            detokenizedHTML += `<span class="token-replaced">${escapedOriginal}</span>`;
        } else {
            // Токен не найден - оставить как есть
            const escapedToken = escapeHtml(pos.token);
            detokenizedHTML += escapedToken;
        }
        
        lastIndex = pos.index + pos.length;
    });
    
    // Добавить оставшийся текст
    if (lastIndex < text.length) {
        const remainingText = escapeHtml(text.substring(lastIndex));
        detokenizedHTML += remainingText;
    }
    
    if (detokenizedHTML === '') {
        detokenizedHTML = escapeHtml(text);
    }
    
    detokenizedTextContainer.innerHTML = detokenizedHTML;
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
