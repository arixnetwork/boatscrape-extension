let selectedFormat = 'csv';
const defaultFields = [
  'title', 'description', 'price', 'images', 'stock_status', 
  'sku', 'categories', 'url'
];

document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.format;
  });
});

document.getElementById('customFields').addEventListener('change', function() {
  const container = document.getElementById('fieldsContainer');
  if (this.checked) {
    container.style.display = 'block';
    populateFieldCheckboxes();
  } else {
    container.style.display = 'none';
  }
});

function populateFieldCheckboxes() {
  const container = document.getElementById('fieldsContainer');
  container.innerHTML = '';
  
  defaultFields.forEach(field => {
    const div = document.createElement('div');
    div.className = 'field-item';
    div.innerHTML = `
      <input type="checkbox" id="field_${field}" checked>
      <label for="field_${field}">${field.replace('_', ' ')}</label>
    `;
    container.appendChild(div);
  });
}

document.getElementById('scrapeBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Validate we have a valid tab
  if (!tab || !tab.url || !tab.id) {
    updateStatus('Please open a valid webpage first', 'error');
    return;
  }
  
  // Check if it's a real webpage (not chrome://, etc.)
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    updateStatus('Cannot scrape browser internal pages', 'error');
    return;
  }
  
  const scrapeAllPages = document.getElementById('scrapeAllPages').checked;
  const useCustomFields = document.getElementById('customFields').checked;
  
  let selectedFields = defaultFields;
  if (useCustomFields) {
    selectedFields = [];
    defaultFields.forEach(field => {
      if (document.getElementById(`field_${field}`).checked) {
        selectedFields.push(field);
      }
    });
  }
  
  document.getElementById('progressContainer').style.display = 'block';
  document.getElementById('progressBar').style.width = '0%';
  updateStatus('Initializing...', 'info');
  
  try {
    // First, ensure content script is injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // This ensures our content script is loaded
        if (typeof window.boatscrapeReady === 'undefined') {
          window.boatscrapeReady = true;
        }
      }
    });
    
    // Now send message to content script
    const result = await chrome.tabs.sendMessage(tab.id, { 
      action: 'scrapeProducts',
      format: selectedFormat,
      scrapeAllPages: scrapeAllPages,
      fields: selectedFields
    });
    
    if (result.success) {
      updateStatus(`Success! ${result.count} products scraped`, 'success');
      
      const mimeType = getMimeType(selectedFormat);
      let blob;
      
      if (selectedFormat === 'xlsx') {
        blob = new Blob([new Uint8Array(result.data)], { type: mimeType });
      } else {
        blob = new Blob([result.data], { type: mimeType });
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `woocommerce-products.${selectedFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } else {
      throw new Error(result.error || 'Scraping failed');
    }
  } catch (error) {
    console.error('Scraping error:', error);
    if (error.message.includes('Receiving end does not exist')) {
      updateStatus('Content script not loaded. Refresh the page and try again.', 'error');
    } else {
      updateStatus(`Error: ${error.message}`, 'error');
    }
  } finally {
    document.getElementById('progressContainer').style.display = 'none';
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'progressUpdate') {
    const percent = Math.min(100, Math.round((request.current / request.total) * 100));
    document.getElementById('progressBar').style.width = `${percent}%`;
    updateStatus(`Scraping page ${request.current} of ${request.total}...`, 'info');
  }
});

function updateStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
}

function getMimeType(format) {
  const types = {
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json'
  };
  return types[format] || 'text/plain';
}