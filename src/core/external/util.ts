export function normalizeSlash(input: string): string {
    return input.replace(/\/+/g, '/');
}

export function getElapsedTimeInString(endTime: [number, number]): string {
    const elapsedTimeInSeconds = endTime[0] + endTime[1] / 1e9;
    const elapsedTimeInMilliseconds = elapsedTimeInSeconds * 1000;

    // 초는 1자리 소수로 표시하고, 밀리초는 정수로 표시
    return `${elapsedTimeInSeconds.toFixed(1)}s (${Math.round(elapsedTimeInMilliseconds)}ms)`;
}

/**
 * 단어를 복수형으로 변환합니다 (간단한 영어 규칙)
 */
export function pluralize(word: string): string {
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
        return word + 'es';
    }
    if (word.endsWith('y')) {
        return word.slice(0, -1) + 'ies';
    }
    return word + 's';
}

/**
 * 단어를 단수형으로 변환합니다 (간단한 영어 규칙)
 */
export function singularize(word: string): string {
    if (word.endsWith('ies')) {
        return word.slice(0, -3) + 'y';
    }
    // Only strip 'es' for words whose stem ends in s, x, ch, or sh (inverse of pluralize rule)
    if (
        word.endsWith('ses') ||
        word.endsWith('xes') ||
        word.endsWith('ches') ||
        word.endsWith('shes')
    ) {
        return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
        return word.slice(0, -1);
    }
    return word;
}

/**
 * 페이지네이션 커서를 생성합니다 (TypeORM 호환 형식)
 */
export function createPaginationCursor(total: number): string {
    return Buffer.from(
        `{"nextCursor":"${Buffer.from(total.toString()).toString('base64')}","total":${total}}`,
    ).toString('base64');
}
