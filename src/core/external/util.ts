export function normalizeSlash(input: string): string {
    return input.replace(/\/+/g, '/');
}


export function getElapsedTimeInString(endTime: [number, number]): string {
    const elapsedTimeInSeconds = endTime[0] + endTime[1] / 1e9;
    const elapsedTimeInMilliseconds = elapsedTimeInSeconds * 1000;

    // 초는 1자리 소수로 표시하고, 밀리초는 정수로 표시
    return `${elapsedTimeInSeconds.toFixed(1)}s (${Math.round(elapsedTimeInMilliseconds)}ms)`;
}