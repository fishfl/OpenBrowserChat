document.addEventListener("DOMContentLoaded", () => {
    const providerSelect = document.getElementById("providerSelect") as HTMLSelectElement;
    const customUrlGroup = document.getElementById("customUrlGroup") as HTMLDivElement;
    const providerUrlInput = document.getElementById("providerUrl") as HTMLInputElement;
    const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
    const modelInput = document.getElementById("model") as HTMLInputElement;
    const systemPromptInput = document.getElementById("systemPrompt") as HTMLTextAreaElement;
    const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
    const statusDiv = document.getElementById("status") as HTMLDivElement;

    const PREDEFINED_PROVIDERS = [
        { name: "OpenAI", url: "https://api.openai.com/v1/chat/completions" },
        { name: "Google (Gemini)", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
        { name: "DeepSeek", url: "https://api.deepseek.com/chat/completions" },
        { name: "月之暗面 (Kimi)", url: "https://api.moonshot.cn/v1/chat/completions" },
        { name: "阿里百炼 (DashScope)", url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
        { name: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions" },
        { name: "自定义 URL", url: "custom" }
    ];

    // Populate dropdown options
    PREDEFINED_PROVIDERS.forEach(provider => {
        const option = document.createElement("option");
        option.value = provider.url;
        option.textContent = provider.name;
        providerSelect.appendChild(option);
    });

    const PREDEFINED_URLS = PREDEFINED_PROVIDERS.map(p => p.url);

    providerSelect.addEventListener("change", () => {
        if (providerSelect.value === "custom") {
            customUrlGroup.style.display = "block";
        } else {
            customUrlGroup.style.display = "none";
            providerUrlInput.value = providerSelect.value;
        }
    });

    // Load existing config
    chrome.storage.sync.get(["config"], (data: { [key: string]: any }) => {
        if (data.config) {
            const savedUrl = data.config.providerUrl || "";
            if (savedUrl) {
                if (PREDEFINED_URLS.includes(savedUrl)) {
                    providerSelect.value = savedUrl;
                    customUrlGroup.style.display = "none";
                    providerUrlInput.value = savedUrl;
                } else {
                    providerSelect.value = "custom";
                    customUrlGroup.style.display = "block";
                    providerUrlInput.value = savedUrl;
                }
            }
            apiKeyInput.value = data.config.apiKey || "";
            modelInput.value = data.config.model || "";
            systemPromptInput.value = data.config.systemPrompt || "你是一个有用的助手。";
        }
    });

    saveBtn.addEventListener("click", () => {
        const config = {
            providerUrl: providerUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim(),
            systemPrompt: systemPromptInput.value.trim()
        };

        chrome.storage.sync.set({ config: config }, () => {
            statusDiv.innerText = "配置已保存！";
            setTimeout(() => {
                statusDiv.innerText = "";
            }, 2000);
        });
    });
});
