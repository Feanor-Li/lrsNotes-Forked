import handUpImage from '@/assets/hand-up.svg?url'
import handDownImage from '@/assets/hand-down.svg?url'
import handOffImage from '@/assets/hand-off.svg?url'

/**
 * 上警状态相关的纯函数
 * 从 useBoard 中抽出，PlayerCard 只需要这几个方法，
 * 无需实例化整个笔记面板逻辑
 */

export function getElectionImage(election) {
    switch (election) {
        case 1: return handUpImage
        case 2: return handDownImage
        case 3: return handOffImage
        default: return handOffImage
    }
}

export function getElectionAlt(election) {
    switch (election) {
        case 1: return '警上刚手'
        case 2: return '警上放手'
        case 3: return '警下'
        default: return '警下'
    }
}

export function toggleElection(player) {
    player.election = (player.election % 3) + 1
}
