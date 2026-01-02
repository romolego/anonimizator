// Глобальные переменные
let workbook = null;
let currentSheet = null;
let originalData = [];
let tokenizedData = [];
let tokenDictionary = new Map(); // original -> token
let reverseDictionary = new Map(); // token -> original
let currentDictionary = new Map(); // для детокенизации

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
        sheetSelect.innerHTML = '';
        
        if (sheetNames.length > 1) {
            sheetNames.forEach((name, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = name;
                sheetSelect.appendChild(option);
            });
            document.getElementById('sheetSelection').style.display = 'block';
            sheetSelect.addEventListener('change', loadSheet);
        } else {
            document.getElementById('sheetSelection').style.display = 'none';
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
    
    displayOriginalTable();
    showColumnSelection();
}

// Отображение исходной таблицы
function displayOriginalTable() {
    const table = document.getElementById('originalTable');
    table.innerHTML = '';
    
    if (originalData.length === 0) return;
    
    // Создать заголовки
    const headerRow = document.createElement('tr');
    const maxCols = Math.max(...originalData.map(row => row.length));
    for (let i = 0; i < maxCols; i++) {
        const th = document.createElement('th');
        th.textContent = `Столбец ${i + 1}`;
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    originalData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.textContent = row[i] || '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
    
    document.getElementById('originalTableSection').style.display = 'block';
}

// Показать выбор столбцов
function showColumnSelection() {
    if (originalData.length === 0) return;
    
    const maxCols = Math.max(...originalData.map(row => row.length));
    const container = document.getElementById('columnCheckboxes');
    container.innerHTML = '';
    
    for (let i = 0; i < maxCols; i++) {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = i;
        
        const span = document.createElement('span');
        span.textContent = `Столбец ${i + 1}`;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        container.appendChild(label);
    }
    
    document.getElementById('columnSelection').style.display = 'block';
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
    const checkboxes = document.querySelectorAll('#columnCheckboxes input[type="checkbox"]:checked');
    const selectedColumns = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    if (selectedColumns.length === 0) {
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
    document.getElementById('tokenizedTableSection').style.display = 'block';
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
        th.textContent = `Столбец ${i + 1}`;
        headerRow.appendChild(th);
    }
    table.appendChild(headerRow);
    
    // Создать строки данных
    tokenizedData.forEach(row => {
        const tr = document.createElement('tr');
        for (let i = 0; i < maxCols; i++) {
            const td = document.createElement('td');
            td.textContent = row[i] || '';
            tr.appendChild(td);
        }
        table.appendChild(tr);
    });
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
    
    // Найти все токены вида [[...]]
    const tokenRegex = /\[\[([^\]]+)\]\]/g;
    const foundTokens = new Map(); // token -> count
    
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const token = match[0]; // Полный токен с [[ и ]]
        foundTokens.set(token, (foundTokens.get(token) || 0) + 1);
    }
    
    // Отобразить список токенов
    tokensListContainer.innerHTML = '';
    
    if (foundTokens.size === 0) {
        tokensListContainer.innerHTML = '<p style="color: #666; font-size: 12px;">Токены не найдены</p>';
        detokenizedTextContainer.textContent = text;
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
        statusSpan.style.fontSize = '11px';
        statusSpan.textContent = isFound ? 'found' : 'not found';
        
        info.appendChild(tokenSpan);
        info.appendChild(countSpan);
        info.appendChild(statusSpan);
        item.appendChild(info);
        
        tokensListContainer.appendChild(item);
    });
    
    // Детокенизировать текст
    let detokenizedText = text;
    currentDictionary.forEach((original, token) => {
        // Заменять только токены, которые есть в словаре
        const regex = new RegExp(escapeRegExp(token), 'g');
        detokenizedText = detokenizedText.replace(regex, original);
    });
    
    detokenizedTextContainer.textContent = detokenizedText;
}

// Экранирование спецсимволов для regex
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Промпт-подсказка
function togglePromptHint(button) {
    const content = document.getElementById('promptHintContent');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        button.textContent = '▼ Промпт-подсказка';
    } else {
        content.style.display = 'none';
        button.textContent = '▶ Промпт-подсказка';
    }
}

function copyPromptHint(button) {
    const text = 'Значения вида [[...]] нельзя менять';
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

