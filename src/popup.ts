export interface Skill {
    id: string;      // 例如 "baoyu-comic"
    content: string; // 文件里的 markdown prompt 原文
}

document.addEventListener("DOMContentLoaded", () => {
    const providerSelect = document.getElementById("providerSelect") as HTMLSelectElement;
    const customUrlGroup = document.getElementById("customUrlGroup") as HTMLDivElement;
    const providerUrlInput = document.getElementById("providerUrl") as HTMLInputElement;
    const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
    const modelInput = document.getElementById("model") as HTMLInputElement;
    const systemPromptInput = document.getElementById("systemPrompt") as HTMLTextAreaElement;
    const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
    const statusDiv = document.getElementById("status") as HTMLDivElement;
    const skillUpload = document.getElementById("skillUpload") as HTMLInputElement;
    const skillListUI = document.getElementById("skillList") as HTMLUListElement;

    let currentSkills: Skill[] = [];

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

    // Load existing config and skills
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

    chrome.storage.local.get(["skills"], (data) => {
        if (data.skills) {
            currentSkills = data.skills as Skill[];
            renderSkillList();
        }
    });

    // Handle Skill uploads
    skillUpload.addEventListener("change", async (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (!target.files || target.files.length === 0) return;

        let hasNew = false;
        
        for (let i = 0; i < target.files.length; i++) {
            const file = target.files[i];
            const textContent = await file.text();
            
            let skillId = "";

            // Try to extract name from YAML frontmatter (e.g., "name: baoyu-comic")
            const yamlMatch = textContent.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
            if (yamlMatch) {
                const frontmatter = yamlMatch[1];
                const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
                if (nameMatch) {
                    skillId = nameMatch[1].trim();
                }
            }

            // Fallback to filename if no frontmatter name exists
            if (!skillId) {
                skillId = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
                if (skillId.toLowerCase() === "skill" && file.webkitRelativePath) {
                    // Handle cases where users upload folders like "my-skill/SKILL.md", we fallback to folder name if possible 
                    const pathParts = file.webkitRelativePath.split('/');
                    if(pathParts.length >= 2) {
                         skillId = pathParts[pathParts.length - 2];
                    }
                }
            }
            // Basic sanitization
            skillId = skillId.replace(/[^a-zA-Z0-9_-]/g, "");

            // Look for existing and update, or add new
            const existingIdx = currentSkills.findIndex(s => s.id === skillId);
            if (existingIdx >= 0) {
                currentSkills[existingIdx].content = textContent;
            } else {
                currentSkills.push({ id: skillId, content: textContent });
            }
            hasNew = true;
        }

        if (hasNew) {
            chrome.storage.local.set({ skills: currentSkills }, () => {
                skillUpload.value = ""; // clear input
                renderSkillList();
                statusDiv.innerText = "技能已成功载入系统！";
                setTimeout(() => { statusDiv.innerText = ""; }, 2000);
            });
        }
    });

    // Handle Tabs
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active classes
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // Add active to clicked tab
            tab.classList.add('active');
            
            // Show corresponding content
            const targetId = tab.getAttribute('data-target');
            if (targetId) {
                document.getElementById(targetId)?.classList.add('active');
            }
        });
    });

    function renderSkillList() {
        skillListUI.innerHTML = "";
        currentSkills.forEach((skill, idx) => {
            const li = document.createElement("li");
            li.style.display = "flex";
            li.style.justifyContent = "space-between";
            li.style.background = "#fafafa";
            li.style.border = "1px solid #ddd";
            li.style.padding = "4px";
            li.style.marginBottom = "5px";
            li.style.borderRadius = "4px";

            const nameSpan = document.createElement("span");
            nameSpan.innerText = `/${skill.id}`;
            nameSpan.style.color = "#0056b3";
            nameSpan.style.fontWeight = "bold";

            const delBtn = document.createElement("button");
            delBtn.innerText = "移除";
            delBtn.style.padding = "2px 5px";
            delBtn.style.width = "auto";
            delBtn.style.fontSize = "11px";
            delBtn.style.background = "#ff4d4f";
            delBtn.onclick = () => {
                currentSkills.splice(idx, 1);
                chrome.storage.local.set({ skills: currentSkills }, renderSkillList);
            };

            li.appendChild(nameSpan);
            li.appendChild(delBtn);
            skillListUI.appendChild(li);
        });
    }

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
