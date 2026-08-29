import {ref, computed, watch, onMounted, onUnmounted} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useGameModeStore} from '@/stores/gameModeStore'
import {storeToRefs} from 'pinia'
import {getElectionImage, getElectionAlt, toggleElection} from '@/composables/useElection'

/**
 * 共享的笔记面板逻辑
 * 被 board.vue 和 board-full.vue 共同使用
 *
 * 面板内容按「页」（每页对应一个夜晚 Night）拆分：
 * - pages: [{ id, title, remarks, chatRecords }]
 * - activeIndex: 当前显示的页
 * remarks / chatRecords 始终指向当前页，因此下方所有逻辑无需改动。
 * 所有页会整体存入 localStorage，刷新后依旧保留。
 */

const STORAGE_KEY = 'boardPages'

// 一页里 12 名玩家的初始发言记录
function createChatRecords() {
    return Object.fromEntries(
        Array.from({length: 12}, (_, i) => {
            const playerKey = `player${String(i + 1).padStart(2, '0')}`
            return [playerKey, {
                election: 3,   // 上警信息 1-警上刚手, 2-警上放手, 3-警下
                flag: true,    // 是否存在（非12人场预留）
                message: '',   // 发言信息
                sign: '',      // 标记信息 如 '狼', '民'
                status: 1,     // 存活状态 1-存活, 2-放逐出局, 3-其他死亡
            }]
        })
    )
}

let pageSeq = 0
function createPage(title) {
    pageSeq += 1
    return {
        id: `${Date.now()}-${pageSeq}`,
        title: title || `Night ${pageSeq}`,
        remarks: '',
        chatRecords: createChatRecords(),
        votes: createVotes(),
    }
}

// 一页的投票记录：一张表，每行两格 —— 左格被投玩家，右格投票玩家编号
let voteRowSeq = 0
function createVoteRow() {
    voteRowSeq += 1
    return {id: `v-${Date.now()}-${voteRowSeq}`, target: '', voters: ''}
}

function createVotes() {
    return [createVoteRow(), createVoteRow(), createVoteRow()]
}

// 兼容旧数据：既支持新版数组，也支持早期的 {targets, voters} 双文本格式
function normalizeVotes(raw) {
    if (Array.isArray(raw)) {
        const rows = raw
            .filter(r => r && typeof r === 'object')
            .map(r => ({
                id: r.id || createVoteRow().id,
                target: String(r.target || ''),
                voters: String(r.voters || ''),
            }))
        return rows.length ? rows : createVotes()
    }
    if (raw && typeof raw === 'object' && ('targets' in raw || 'voters' in raw)) {
        const targets = String(raw.targets || '').split('\n')
        const voters = String(raw.voters || '').split('\n')
        const count = Math.max(targets.length, voters.length)
        const rows = []
        for (let i = 0; i < count; i++) {
            const target = (targets[i] || '').trim()
            const voter = (voters[i] || '').trim()
            if (target || voter) {
                rows.push({...createVoteRow(), target, voters: voter})
            }
        }
        return rows.length ? rows : createVotes()
    }
    return createVotes()
}

export function useBoard() {
    const store = useGameModeStore()
    const {selectedMode} = storeToRefs(store)

    // 分页数据
    const pages = ref([createPage('Night 1')])
    const activeIndex = ref(0)

    const activePage = computed(() => pages.value[activeIndex.value] || pages.value[0])

    // 自记信息（指向当前页）
    const remarks = computed({
        get: () => activePage.value.remarks,
        set: (v) => { activePage.value.remarks = v },
    })

    // 发言信息（指向当前页）—— 只做嵌套字段的读写，不整体替换
    const chatRecords = computed(() => activePage.value.chatRecords)

    // 投票信息（指向当前页）
    const votes = computed(() => activePage.value.votes)

    // 导出相关
    const showExportDialog = ref(false)
    const exportedInfo = ref('')

    // 版型设置
    const showGameSettings = ref(false)
    const showSettings = ref(false)
    const gameSettingsRef = ref(null)

    // 响应式对话框宽度
    const windowWidth = ref(window.innerWidth)
    const dialogWidth = computed(() => windowWidth.value >= 768 ? '50%' : '80%')

    const handleResize = () => {
        windowWidth.value = window.innerWidth
    }

    // 快捷短语选项
    const options = computed(() => selectedMode.value?.phrases || [])

    // 版型简述
    const modeDesc = computed(() => {
        if (!selectedMode.value || !selectedMode.value.roles) return ''
        return selectedMode.value.roles.map(r => r.count > 1 ? r.count + r.text : r.text).join('·')
    })

    // ---- 分页操作 ----
    const switchPage = (index) => {
        if (index >= 0 && index < pages.value.length) {
            activeIndex.value = index
        }
    }

    const addPage = () => {
        pages.value.push(createPage(`Night ${pages.value.length + 1}`))
        activeIndex.value = pages.value.length - 1
    }

    const removePage = (index) => {
        if (pages.value.length <= 1) return
        pages.value.splice(index, 1)
        if (activeIndex.value > index) {
            activeIndex.value -= 1
        } else if (activeIndex.value >= pages.value.length) {
            activeIndex.value = pages.value.length - 1
        }
    }

    const renamePage = (index, title) => {
        const page = pages.value[index]
        if (!page) return
        const next = (title || '').trim()
        if (next) page.title = next
    }

    // ---- 持久化 ----
    onMounted(() => {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
            try {
                const parsed = JSON.parse(saved)
                if (parsed && Array.isArray(parsed.pages) && parsed.pages.length) {
                    pages.value = parsed.pages.map((p, i) => ({
                        id: p.id || `${Date.now()}-${i}`,
                        title: p.title || `Night ${i + 1}`,
                        remarks: p.remarks || '',
                        chatRecords: Object.assign(createChatRecords(), p.chatRecords || {}),
                        votes: normalizeVotes(p.votes),
                    }))
                    pageSeq = pages.value.length
                    activeIndex.value = Math.min(
                        Math.max(parsed.activeIndex || 0, 0),
                        pages.value.length - 1
                    )
                }
            } catch (e) {
                // 数据损坏则忽略，保留默认空白页
            }
        } else {
            // 迁移旧版单页数据
            const legacyRemarks = localStorage.getItem('remarks')
            const legacyRecords = localStorage.getItem('chatRecords')
            if (legacyRemarks || legacyRecords) {
                const page = createPage('Night 1')
                if (legacyRemarks) page.remarks = legacyRemarks
                if (legacyRecords) {
                    try {
                        Object.assign(page.chatRecords, JSON.parse(legacyRecords))
                    } catch (e) {
                        // ignore
                    }
                }
                pages.value = [page]
                pageSeq = 1
            }
        }

        window.addEventListener('resize', handleResize)
    })

    onUnmounted(() => {
        window.removeEventListener('resize', handleResize)
    })

    // 自动保存到 localStorage（整体保存所有页）
    const persist = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            pages: pages.value,
            activeIndex: activeIndex.value,
        }))
    }

    watch(pages, persist, {deep: true})
    watch(activeIndex, persist)

    // 处理失焦修剪（key 为 null 时只处理自记信息）
    const handleBlur = (key) => {
        if (key && chatRecords.value[key]) {
            chatRecords.value[key].message = chatRecords.value[key].message.trim()
        }
        remarks.value = remarks.value.trim()
    }

    // 角色更新
    const updatePlayerRole = (playerKey, newRole) => {
        chatRecords.value[playerKey].sign = newRole
    }

    // 新增一行投票记录
    const addVoteRow = () => {
        votes.value.push(createVoteRow())
    }

    // 删除某一行投票记录（保留至少一行）
    const removeVoteRow = (index) => {
        if (votes.value.length <= 1) {
            votes.value[0].target = ''
            votes.value[0].voters = ''
            return
        }
        votes.value.splice(index, 1)
    }

    // 投票信息失焦修剪
    const handleVoteBlur = (index) => {
        const row = votes.value[index]
        if (!row) return
        row.target = row.target.trim()
        row.voters = row.voters.trim()
    }

    // 重置投票信息（仅当前页）
    const resetVotes = () => {
        ElMessageBox.confirm('确定要重置当前页的投票信息吗？', '重置投票信息', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning', center: true,
        }).then(() => {
            votes.value.splice(0, votes.value.length, ...createVotes())
            ElMessage({type: 'success', message: '投票信息已重置', duration: 500})
        }).catch(() => {
            ElMessage({type: 'info', message: '已取消重置', duration: 500})
        })
    }

    // 重置自记信息（仅当前页）
    const resetRemarks = () => {
        ElMessageBox.confirm('确定要重置当前页的自记信息吗？', '重置自记信息', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning', center: true,
        }).then(() => {
            remarks.value = ''
            ElMessage({type: 'success', message: '自记信息已重置', duration: 500})
        }).catch(() => {
            ElMessage({type: 'info', message: '已取消重置', duration: 500})
        })
    }

    // 重置发言信息（仅当前页）
    const resetTalks = () => {
        ElMessageBox.confirm('确定要重置当前页所有玩家的发言内容吗？', '重置发言信息', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning', center: true,
        }).then(() => {
            Object.keys(chatRecords.value).forEach(key => {
                chatRecords.value[key].message = ''
                chatRecords.value[key].sign = ''
                chatRecords.value[key].election = 3
            })
            ElMessage({type: 'success', message: '所有发言信息已重置', duration: 500})
        }).catch(() => {
            ElMessage({type: 'info', message: '已取消重置', duration: 500})
        })
    }

    // 一键上警（仅当前页）
    const handUp = () => {
        ElMessageBox.confirm('确定要使当前页所有玩家更新为上警举手状态吗？', '一键上警', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning', center: true,
        }).then(() => {
            Object.keys(chatRecords.value).forEach(key => {
                chatRecords.value[key].election = 1
            })
            ElMessage({type: 'success', message: '所有玩家已上警', duration: 500})
        }).catch(() => {
            ElMessage({type: 'info', message: '已取消更新', duration: 500})
        })
    }

    // 导出笔记信息（当前页）
    const exportInfo = () => {
        let info = `版型：${selectedMode.value ? selectedMode.value.name : '未选择'}\n`
        info += `页面：${activePage.value.title}\n`
        info += `♫♪♫♪♫♪♫♪♫♪♫♪♫♪\n`
        info += `自记信息：\n${remarks.value.trim()}\n`
        info += `♫♪♫♪♫♪♫♪♫♪♫♪♫♪\n`

        const upPlayers = Object.entries(chatRecords.value)
            .filter(([_, record]) => record.election === 1 || record.election === 2)
            .map(([key]) => key.slice(-2))

        const downPlayers = Object.entries(chatRecords.value)
            .filter(([_, record]) => record.election === 3)
            .map(([key]) => key.slice(-2))

        if (upPlayers.length > 0) {
            if (upPlayers.length === 12) {
                info += `（全员上警）\n`
            } else {
                info += `警上：[${upPlayers.join(',')}]\n`
                info += `警下：[${downPlayers.join(',')}]\n`
            }
            info += `♫♪♫♪♫♪♫♪♫♪♫♪♫♪\n`
        }

        info += `发言信息：\n`
        const allDown = downPlayers.length === 12

        Object.entries(chatRecords.value).forEach(([key, record]) => {
            const playerNumber = key.slice(-2)
            let electionSymbol = ''
            if (!allDown) {
                electionSymbol = (record.election === 1 || record.election === 2) ? '*' : '_'
            }
            const messageLines = record.message.split('\n')
            if (messageLines.length > 0) {
                info += `[${playerNumber}]${electionSymbol} ${messageLines[0]}\n`
                for (let i = 1; i < messageLines.length; i++) {
                    info += `   \t ${messageLines[i]}\n`
                }
            }
        })

        const filledVotes = votes.value.filter(r => r.target.trim() || r.voters.trim())
        if (filledVotes.length) {
            info += `♫♪♫♪♫♪♫♪♫♪♫♪♫♪\n`
            info += `投票信息：\n`
            filledVotes.forEach(r => {
                info += `${r.target.trim() || '?'} <- ${r.voters.trim()}\n`
            })
        }

        exportedInfo.value = info.trim()
        showExportDialog.value = true
    }

    // 复制导出信息
    const copyExportedInfo = () => {
        navigator.clipboard.writeText(exportedInfo.value).then(() => {
            ElMessage({message: '信息已复制到剪贴板', type: 'success', duration: 2000})
            showExportDialog.value = false
        }).catch(() => {
            ElMessage({message: '复制失败，请手动复制', type: 'error', duration: 2000})
        })
    }

    // 设置对话框
    const openSettings = () => {
        showGameSettings.value = true
    }

    const handleSettingsClose = (done) => {
        if (gameSettingsRef.value) {
            gameSettingsRef.value.handleClose((shouldClose) => {
                if (shouldClose) {
                    showSettings.value = false
                    done()
                }
            })
        } else {
            done()
        }
    }

    const updateConfig = (newConfig) => {
        store.updateGameModes(newConfig)
    }

    return {
        store, selectedMode, remarks, chatRecords, votes,
        pages, activeIndex, switchPage, addPage, removePage, renamePage,
        showExportDialog, exportedInfo, showGameSettings,
        showSettings, gameSettingsRef, dialogWidth, options, modeDesc,
        handleBlur, handleVoteBlur, addVoteRow, removeVoteRow,
        getElectionImage, getElectionAlt, toggleElection,
        resetRemarks, resetTalks, resetVotes, handUp, exportInfo, copyExportedInfo,
        handleSettingsClose, openSettings, updatePlayerRole, updateConfig
    }
}
