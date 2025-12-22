// utils/fileLoader.js

/**
 * 주어진 파일 경로에서 텍스트 콘텐츠를 비동기적으로 불러옵니다.
 * @param {string} filePath - 불러올 텍스트 파일의 경로
 * @returns {Promise<string>} 파일 내용 또는 오류 메시지를 반환하는 Promise
 */

function resolveFileUrl(filePath) {
    if (typeof filePath !== 'string') return filePath;
    if (
        /^(?:[a-z]+:)?\/\//i.test(filePath) ||
        filePath.startsWith('data:') ||
        filePath.startsWith('blob:') ||
        filePath.startsWith('chrome-extension://')
    ) {
        return filePath;
    }
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
        return chrome.runtime.getURL(filePath);
    }
    return filePath;
}

export async function loadTextContent(filePath) {
    try {
        const response = await fetch(resolveFileUrl(filePath));

        if (!response.ok) {
            // 파일을 찾지 못했거나 서버 오류가 발생했을 경우
            throw new Error(`파일 로드 실패: ${response.status} (${filePath})`);
        }

        const textContent = await response.text();
        return textContent;
    } catch (error) {
        console.error("텍스트 파일 로딩 중 오류 발생:", error);
        return `[ERROR] 텍스트 파일을 불러올 수 없습니다.`;
    }
}
