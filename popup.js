let scrapedData = [];

document.getElementById("scrape").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ["content.js"]
    },
    () => {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "SCRAPED_DATA") {
          scrapedData = msg.data;
          document.getElementById("status").innerText =
            `✅ ${scrapedData.length} products scraped`;
        }
      });
    }
  );
});

document.getElementById("download").addEventListener("click", () => {
  if (!scrapedData.length) {
    alert("No data scraped yet!");
    return;
  }

  const format = document.getElementById("format").value;
  let blob, filename;

  if (format === "json") {
    blob = new Blob([JSON.stringify(scrapedData, null, 2)], { type: "application/json" });
    filename = "boatscrape-products.json";
  } else {
    const csv = convertToCSV(scrapedData);
    blob = new Blob([csv], { type: "text/csv" });
    filename = "boatscrape-products.csv";
  }

  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename
  });
});

function convertToCSV(data) {
  const headers = Object.keys(data[0]);
  const rows = data.map(obj =>
    headers.map(h => `"${(obj[h] || "").toString().replace(/"/g, '""')}"`).join(",")
  );
  return headers.join(",") + "\n" + rows.join("\n");
}
