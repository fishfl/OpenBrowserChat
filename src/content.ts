interface AppConfig {
    providerUrl: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
}

let contexts: string[] = [];
let chatBoxUI: HTMLDivElement | null = null;
let contextListUI: HTMLDivElement | null = null;
let chatMessagesUI: HTMLDivElement | null = null;
let config: AppConfig = {
    providerUrl: "",
    apiKey: "",
    model: "",
    systemPrompt: "你是一个有用的助手。"
};

// Generate a unique token for THIS SPECIFIC tab instance
const myTabToken = Math.random().toString(36).substring(2);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "requestSelection") {
        const selection = window.getSelection()?.toString();
        if (selection && selection.trim().length > 0) {
            addContext(selection);
        }
        
        // Announce to all other tabs that THIS tab is now the owner of the chat
        chrome.storage.local.set({ chatOwnerToken: myTabToken });
        
        showChatUI();
    }
});

// Load config and existing contexts
chrome.storage.sync.get(["config", "contexts"], (data: { [key: string]: any }) => {
    if (data.config) config = data.config as AppConfig;
    if (data.contexts) contexts = data.contexts as string[];
});

// Sync state across different tabs
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        if (changes.contexts) {
            contexts = (changes.contexts.newValue || []) as string[];
            updateContextUI();
        }
        if (changes.config) {
            config = changes.config.newValue as AppConfig;
        }
    }
    
    if (namespace === 'local' && changes.chatOwnerToken) {
        // If the new owner token does NOT match MY token, it means another tab became the boss.
        // Therefore, I must hide my chat UI immediately!
        if (changes.chatOwnerToken.newValue !== myTabToken) {
            if (chatBoxUI) {
                chatBoxUI.style.display = "none";
            }
        }
    }
});

function addContext(text: string) {
    if (!contexts.includes(text)) {
        contexts.push(text);
        chrome.storage.sync.set({ contexts: contexts });
        updateContextUI();
    }
}

function removeContext(index: number) {
    contexts.splice(index, 1);
    chrome.storage.sync.set({ contexts: contexts });
    updateContextUI();
}

function clearAllContexts() {
    contexts = [];
    chrome.storage.sync.set({ contexts: contexts });
    updateContextUI();
}

function showChatUI() {
    if (!chatBoxUI) {
        createChatUI();
    }
    chatBoxUI!.style.display = "flex";
    updateContextUI();
}

function createChatUI() {
    chatBoxUI = document.createElement("div");
    chatBoxUI.id = "ai-assistant-chat-box";
    
    const header = document.createElement("div");
    header.className = "chat-header";
    header.innerHTML = `<span>AI 助手</span> <button id="close-chat-btn">x</button>`;
    
    const contentArea = document.createElement("div");
    contentArea.className = "chat-content-area";

    contextListUI = document.createElement("div");
    contextListUI.className = "context-list-area";
    
    chatMessagesUI = document.createElement("div");
    chatMessagesUI.className = "chat-messages-area";

    contentArea.appendChild(contextListUI);
    contentArea.appendChild(chatMessagesUI);

    const inputArea = document.createElement("div");
    inputArea.className = "chat-input-area";
    
    const inputField = document.createElement("textarea");
    inputField.id = "chat-input-field";
    inputField.placeholder = "输入你的问题...";
    
    const sendBtn = document.createElement("button");
    sendBtn.innerText = "发送";
    sendBtn.onclick = () => sendMessage(inputField.value);

    inputArea.appendChild(inputField);
    inputArea.appendChild(sendBtn);

    chatBoxUI.appendChild(header);
    chatBoxUI.appendChild(contentArea);
    chatBoxUI.appendChild(inputArea);
    
    document.body.appendChild(chatBoxUI);

    document.getElementById("close-chat-btn")!.onclick = () => {
        chatBoxUI!.style.display = "none";
    };
}

function updateContextUI() {
    if (!contextListUI) return;
    contextListUI.innerHTML = `<div class="context-header"><span>当前上下文</span> <button class="clear-btn">清空所有</button></div>`;
    
    contextListUI.querySelector('.clear-btn')?.addEventListener('click', clearAllContexts);

    const list = document.createElement("ul");
    contexts.forEach((ctx, idx) => {
        const li = document.createElement("li");
        const ctxText = document.createElement("span");
        ctxText.className = "context-text";
        ctxText.innerText = ctx.length > 50 ? ctx.substring(0, 50) + "..." : ctx;
        ctxText.title = ctx;
        
        const removeBtn = document.createElement("button");
        removeBtn.innerText = "x";
        removeBtn.onclick = () => removeContext(idx);
        
        li.appendChild(ctxText);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
    contextListUI.appendChild(list);
}

function appendMessage(role: "user" | "ai", text: string) {
    if (!chatMessagesUI) return;
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-message ${role}-message`;
    msgDiv.innerText = text;
    chatMessagesUI.appendChild(msgDiv);
    chatMessagesUI.scrollTop = chatMessagesUI.scrollHeight;
}

async function sendMessage(prompt: string) {
    if (!prompt.trim()) return;
    
    const inputField = document.getElementById("chat-input-field") as HTMLTextAreaElement;
    inputField.value = "";
    
    appendMessage("user", prompt);
    
    // Refresh config in case it was updated
    chrome.storage.sync.get(["config"], async (data: { [key: string]: any }) => {
        if (data.config) config = data.config as AppConfig;
        
        if (!config.providerUrl || !config.apiKey || !config.model) {
            appendMessage("ai", "请先在扩展配置页面设置 API 供应商信息(URL, API Key, Model)。");
            return;
        }

        const messages = [];
        if (config.systemPrompt) {
            messages.push({ role: "system", content: config.systemPrompt });
        }
        
        let fullPrompt = prompt;
        if (contexts.length > 0) {
            const contextStr = contexts.join("\n\n---\n\n");
            fullPrompt = `以下是提供的上下文内容：\n\n${contextStr}\n\n基于以上上下文，请回答：\n${prompt}`;
        }

        messages.push({ role: "user", content: fullPrompt });

        try {
            // Using OpenAI style API request which DeepSeek, Qwen usually support
            appendMessage("ai", "思考中...");
            let loadingMsg = chatMessagesUI!.lastChild as HTMLDivElement;

            const requestBody = {
                model: config.model,
                messages: messages,
                stream: true
            };

            const response = await fetch(config.providerUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${config.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                loadingMsg.innerText = `API 请求失败: ${response.status} ${response.statusText}`;
                return;
            }

            loadingMsg.innerText = "";
            const reader = response.body?.getReader();
            const decoder = new TextDecoder("utf-8");

            if (!reader) throw new Error("无法获取数据流");

            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith("data: ") && trimmedLine !== "data: [DONE]") {
                            try {
                                const dataObj = JSON.parse(trimmedLine.slice(6));
                                const content = dataObj.choices[0]?.delta?.content || "";
                                loadingMsg.innerText += content;
                            } catch (err) {
                                // 忽略解析错误，继续处理下一个 chunk
                            }
                        }
                    }
                    chatMessagesUI!.scrollTop = chatMessagesUI!.scrollHeight;
                }
            }
            
        } catch (e: any) {
             let loadingMsg = chatMessagesUI?.lastChild as HTMLDivElement;
             if(loadingMsg) loadingMsg.innerText = `请求发生错误: ${e.message || String(e)}`;
        }
    });
}
