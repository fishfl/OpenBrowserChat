chrome.commands.onCommand.addListener((command) => {
  if (command === "add_to_context") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "requestSelection" })
          .catch(err => console.warn("无法发送消息到内容脚本，请刷新页面后重试:", err));
      }
    });
  }
});
