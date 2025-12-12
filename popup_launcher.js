// popup_launcher.js
document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

document.getElementById('quickBlock').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs[0] || !tabs[0].url) return;
        
        try {
            const url = new URL(tabs[0].url);
            const domain = url.hostname.replace(/^www\./, '');
            
            chrome.storage.local.get({blockedUrls: []}, (data) => {
                const blocked = data.blockedUrls;
                if (!blocked.includes(domain)) {
                    blocked.push(domain);
                    chrome.storage.local.set({blockedUrls: blocked}, () => {
                        const msg = document.getElementById('msg');
                        msg.textContent = `${domain} 차단됨!`;
                        chrome.runtime.sendMessage({ action: "SETTINGS_UPDATED" });
                    });
                } else {
                    document.getElementById('msg').textContent = '이미 차단된 사이트입니다.';
                }
            });
        } catch (e) {
            document.getElementById('msg').textContent = '유효하지 않은 URL';
        }
    });
});