import { marked } from "marked";

interface AppConfig {
    providerUrl: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
}

interface Skill {
    id: string;
    content: string;
}

interface ChatMessage {
    role: "user" | "ai";
    text: string;
}

let chatHistory: ChatMessage[] = [];
let contexts: string[] = [];
let availableSkills: Skill[] = [];
let chatBoxUI: HTMLDivElement | null = null;
let contextListUI: HTMLDivElement | null = null;
let chatMessagesUI: HTMLDivElement | null = null;
let skillSuggestionUI: HTMLDivElement | null = null;
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

chrome.storage.local.get(["skills", "chatHistory"], (data) => {
    if (data.skills) availableSkills = data.skills as Skill[];
    if (data.chatHistory) {
        chatHistory = data.chatHistory as ChatMessage[];
        renderChatHistory();
    }
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
    
    if (namespace === 'local' && changes.skills) {
        availableSkills = (changes.skills.newValue || []) as Skill[];
    }

    if (namespace === 'local' && changes.chatHistory) {
        chatHistory = (changes.chatHistory.newValue || []) as ChatMessage[];
        renderChatHistory();
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
    header.innerHTML = `<span>AI 助手</span> <div><button id="clear-history-btn" title="清空历史" style="margin-right:8px; font-size:12px;">🗑️</button> <button id="close-chat-btn">x</button></div>`;
    
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
    
    skillSuggestionUI = document.createElement("div");
    skillSuggestionUI.className = "skill-suggestion-popup";
    
    const inputField = document.createElement("textarea");
    inputField.id = "chat-input-field";
    inputField.placeholder = "输入你的问题...";
    
    // Add event listeners for skill suggestions
    // NOTE: We now use the global selectedSuggestionIndex and don't shadow it inside initializeChatUI
    let filteredSkills: Skill[] = [];

    // Define a flag to track if we're actively composing.
    let isComposing = false;
    inputField.addEventListener("compositionstart", () => { isComposing = true; });
    inputField.addEventListener("compositionend", () => { isComposing = false; });

    inputField.addEventListener("input", (e) => {
        const val = inputField.value;
        if (val.startsWith("/")) {
            const query = val.slice(1).trim().toLowerCase();
            filteredSkills = availableSkills.filter(s => s.id.toLowerCase().includes(query));
            
            if (filteredSkills.length > 0) {
                selectedSuggestionIndex = 0; // 默认选中第一项
                renderSkillSuggestions(filteredSkills, inputField);
            } else {
                if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
            }
        } else {
            if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
        }
    });

    inputField.addEventListener("keydown", (e) => {
        const isMenuVisible = skillSuggestionUI && skillSuggestionUI.style.display !== "none";
        const items = (skillSuggestionUI && isMenuVisible) ? skillSuggestionUI.querySelectorAll('.skill-suggestion-item') : null;
        
        // Handle enter key
        if (e.key === 'Enter' && !e.shiftKey) {
            // If menu is open and an item is selected, let the skill selection handle it
            if (isMenuVisible && items && items.length > 0 && selectedSuggestionIndex >= 0 && !isComposing) {
                e.preventDefault();
                const chosenId = filteredSkills[selectedSuggestionIndex].id;
                applySkillSuggestion(chosenId, inputField);
                return;
            }
            
            // Otherwise, send the message
            if (!isComposing) {
                e.preventDefault();
                if (inputField.value.trim()) {
                    if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
                    sendMessage(inputField.value);
                }
            }
            return;
        }

        if (!isMenuVisible || !items) return;
        
        if (items.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
            updateSuggestionHighlight(items);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex - 1 + items.length) % items.length;
            updateSuggestionHighlight(items);
        } else if (e.key === "Tab") {
            if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < items.length) {
                e.preventDefault();
                const chosenId = filteredSkills[selectedSuggestionIndex].id;
                applySkillSuggestion(chosenId, inputField);
            }
        } else if (e.key === "Escape") {
            if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
        }
    });
    
    const sendBtn = document.createElement("button");
    sendBtn.innerText = "发送";
    sendBtn.onclick = () => {
        if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
        sendMessage(inputField.value);
    };

    inputArea.appendChild(skillSuggestionUI);
    inputArea.appendChild(inputField);
    inputArea.appendChild(sendBtn);

    chatBoxUI.appendChild(header);
    chatBoxUI.appendChild(contentArea);
    chatBoxUI.appendChild(inputArea);
    
    document.body.appendChild(chatBoxUI);

    // Initial render of chat history if any exists
    renderChatHistory();

    document.getElementById("clear-history-btn")!.onclick = () => {
        // Clear chat history
        chatHistory = [];
        chrome.storage.local.set({ chatHistory: [] });
        if (chatMessagesUI) chatMessagesUI.innerHTML = "";
        
        // Also clear contexts
        clearAllContexts();
    };

    document.getElementById("close-chat-btn")!.onclick = () => {
        chatBoxUI!.style.display = "none";
    };
}

// Global variables for suggestion handling
let selectedSuggestionIndex = -1;

function renderSkillSuggestions(skillsToShow: Skill[], inputField: HTMLTextAreaElement) {
    if (!skillSuggestionUI) return;
    skillSuggestionUI.innerHTML = "";
    
    skillsToShow.forEach((skill, idx) => {
        const item = document.createElement("div");
        item.className = "skill-suggestion-item";
        item.innerHTML = `<span class="skill-suggestion-name">/${skill.id}</span>`;
        
        item.addEventListener("mousedown", (e) => {
            // Use mousedown instead of click to prevent input blur before trigger
            e.preventDefault(); 
            applySkillSuggestion(skill.id, inputField);
        });
        
        item.addEventListener("mouseenter", () => {
            selectedSuggestionIndex = idx;
            const allItems = skillSuggestionUI!.querySelectorAll('.skill-suggestion-item');
            updateSuggestionHighlight(allItems);
        });
        
        skillSuggestionUI!.appendChild(item);
    });
    // Highlight the very first selected item implicitly right after render if needed
    if (selectedSuggestionIndex >= 0) {
        const allItems = skillSuggestionUI.querySelectorAll('.skill-suggestion-item');
        updateSuggestionHighlight(allItems);
    }
    
    skillSuggestionUI.style.display = "block";
}

function updateSuggestionHighlight(items: NodeListOf<Element>) {
    items.forEach((item, index) => {
        if (index === selectedSuggestionIndex) {
            item.classList.add('active');
            (item as HTMLElement).scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

function applySkillSuggestion(skillId: string, inputField: HTMLTextAreaElement) {
    inputField.value = `/${skillId} `;
    inputField.focus();
    if (skillSuggestionUI) skillSuggestionUI.style.display = "none";
}

function updateContextUI() {
    if (!contextListUI) return;
    // Removed the inline clear-btn from context header
    contextListUI.innerHTML = `<div class="context-header"><span>当前上下文</span></div>`;
    
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

function renderChatHistory() {
    if (!chatMessagesUI) return;
    chatMessagesUI.innerHTML = "";
    
    chatHistory.forEach(msg => {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${msg.role}-message`;
        if (msg.role === "ai") {
            msgDiv.innerHTML = marked.parse(msg.text) as string;
        } else {
            msgDiv.innerText = msg.text;
        }
        chatMessagesUI!.appendChild(msgDiv);
    });
    chatMessagesUI.scrollTop = chatMessagesUI.scrollHeight;
}

function appendMessage(role: "user" | "ai", text: string, saveToHistory: boolean = true) {
    if (!chatMessagesUI) return;
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-message ${role}-message`;
    if (role === "ai" && !saveToHistory) {
        // If it's a temporary loading message or real-time streaming, we'll keep its exact raw state or a parsed state based on how it's handled downstream.
        // Actually, during streaming, appending text incrementally is easier if innerText is used, but for the final message we should render markdown.
        // So for the empty "思考中..." shell we'll just use text.
        msgDiv.innerText = text;
    } else if (role === "ai") {
        msgDiv.innerHTML = marked.parse(text) as string;
    } else {
        msgDiv.innerText = text;
    }
    
    chatMessagesUI.appendChild(msgDiv);
    chatMessagesUI.scrollTop = chatMessagesUI.scrollHeight;

    if (saveToHistory) {
        chatHistory.push({ role, text });
        chrome.storage.local.set({ chatHistory: chatHistory });
    }
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
        
        let finalSystemPrompt = config.systemPrompt;
        let realPrompt = prompt;

        // Check if the user is invoking a skill via /skill-name
        const skillMatch = prompt.match(/^\/([\w-]+)\s*(.*)/);
        if (skillMatch) {
            const requestedSkillId = skillMatch[1];
            const theRestOfPrompt = skillMatch[2];
            
            const matchedSkill = availableSkills.find(s => s.id === requestedSkillId);
            if (matchedSkill) {
                // Prepend or replace the system prompt with the Skill instructions
                finalSystemPrompt = finalSystemPrompt 
                    + "\n\n=== 附加工作流技能指令 ===\n" 
                    + matchedSkill.content;
                realPrompt = theRestOfPrompt; // Strip the /skill prefix for the user prompt
                 
                // Show a mini notification in chat
                appendMessage("ai", `[已触发技能: /${requestedSkillId}]`);
            }
        }

        if (finalSystemPrompt) {
            messages.push({ role: "system", content: finalSystemPrompt });
        }
        
        let fullPrompt = realPrompt;
        if (contexts.length > 0) {
            const contextStr = contexts.join("\n\n---\n\n");
            fullPrompt = `以下是收集到的上下文参考资料：\n\n${contextStr}\n\n=== 用户请求 ===\n${realPrompt}`;
        }

        messages.push({ role: "user", content: fullPrompt });

        try {
            // Using OpenAI style API request which DeepSeek, Qwen usually support
            appendMessage("ai", "思考中...", false);
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
                // Save the error message to history too
                chatHistory.push({ role: "ai", text: loadingMsg.innerText });
                chrome.storage.local.set({ chatHistory: chatHistory });
                return;
            }

            loadingMsg.innerText = "";
            const reader = response.body?.getReader();
            const decoder = new TextDecoder("utf-8");

            if (!reader) throw new Error("无法获取数据流");

            let done = false;
            let fullAiResponse = "";
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
                                fullAiResponse += content;
                                // For real-time streaming, update the UI with partially parsed markdown
                                loadingMsg.innerHTML = marked.parse(fullAiResponse) as string;
                            } catch (err) {
                                // 忽略解析错误，继续处理下一个 chunk
                            }
                        }
                    }
                    chatMessagesUI!.scrollTop = chatMessagesUI!.scrollHeight;
                }
            }

            // Stream finished perfectly, save the final complete message to history
            chatHistory.push({ role: "ai", text: fullAiResponse });
            chrome.storage.local.set({ chatHistory: chatHistory });
            
        } catch (e: any) {
             let loadingMsg = chatMessagesUI?.lastChild as HTMLDivElement;
             if(loadingMsg) {
                 loadingMsg.innerText = `请求发生错误: ${e.message || String(e)}`;
                 chatHistory.push({ role: "ai", text: loadingMsg.innerText });
                 chrome.storage.local.set({ chatHistory: chatHistory });
             }
        }
    });
}
