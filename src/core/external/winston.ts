import winston, { createLogger, transports, format, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { TransformableInfo } from 'logform';
import path from 'path';
import fs from 'fs';

// 로그 레벨과 색상을 체계적으로 정의
const LOG_SETTINGS = {
	error: { level: 0, color: '\x1b[31m', emoji: '❌' },     // 빨강
	Error: { level: 0, color: '\x1b[31m', emoji: '❌' },     // 빨강
	Warn: { level: 1, color: '\x1b[33m', emoji: '⚠️' },      // 노랑
	Info: { level: 2, color: '\x1b[36m', emoji: '💡' },      // 청록색
	Debug: { level: 3, color: '\x1b[35m', emoji: '🐛' },     // 자주색
	Silly: { level: 4, color: '\x1b[90m', emoji: '🔍' },     // 회색
	SQL: { level: 3, color: '\x1b[32m', emoji: '🗃️' },       // 녹색
	Route: { level: 2, color: '\x1b[34m', emoji: '🛣️' },     // 파랑
	SessionDeclaration: { level: 2, color: '\x1b[37m', emoji: '🔐' },  // 흰색
	Footwalk: { level: 2, color: '\x1b[90m', emoji: '👣' },  // 회색
	Email: { level: 2, color: '\x1b[34m', emoji: '📧' },     // 파랑
	Auth: { level: 2, color: '\x1b[34m', emoji: '🔑' },      // 파랑
} as const;

const RESET_COLOR = '\x1b[0m';

// 타입 정의
type LogLevels = typeof LOG_SETTINGS;
type LogLevelNames = keyof LogLevels;

// CustomLevels 타입 정의
type CustomLevels = {
	[K in LogLevelNames]: winston.LeveledLogMethod;
} & Logger;

// 레벨과 색상 매핑 생성
const customLevels = Object.fromEntries(
	Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.level])
);

const customColors = Object.fromEntries(
	Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.color])
);

const customEmojis = Object.fromEntries(
	Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.emoji])
);

// 로그 디렉토리 확인 및 생성
function ensureLogDirectory(): void {
	const logDir = path.resolve('./logs');
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}
}

// 개발/프로덕션 환경에 따른 포맷 설정
function getLogFormat(): winston.Logform.Format {
	const isDevelopment = process.env.NODE_ENV !== 'production';
	
	return format.combine(
		format.timestamp({
			format: 'YYYY-MM-DD HH:mm:ss.SSS',
		}),
		format.errors({ stack: true }),
		format.printf((info: TransformableInfo) => {
			const { timestamp, level, message, stack, ...meta } = info;
			
			// 레벨 정보 가져오기
			const levelInfo = LOG_SETTINGS[level as LogLevelNames];
			const emoji = customEmojis[level as string] || '';
			const color = customColors[level as string] || '';
			
			// 개발 환경에서는 색상과 이모지 사용
			if (isDevelopment) {
				const coloredLevel = `${color}[${level.toUpperCase()}]${RESET_COLOR}`;
				const coloredMessage = `${color}${message}${RESET_COLOR}`;
				
				let logLine = `${timestamp} ${emoji} ${coloredLevel}: ${coloredMessage}`;
				
				// 스택 트레이스가 있으면 추가
				if (stack) {
					logLine += `\n${color}${stack}${RESET_COLOR}`;
				}
				
				// 메타 정보가 있으면 추가
				if (Object.keys(meta).length > 0) {
					logLine += `\n${color}${JSON.stringify(meta, null, 2)}${RESET_COLOR}`;
				}
				
				return logLine;
			} else {
				// 프로덕션 환경에서는 JSON 형태로 로그
				return JSON.stringify({
					timestamp,
					level: level.toUpperCase(),
					message,
					...(stack ? { stack } : {}),
					...meta
				});
			}
		})
	);
}

// 로그 디렉토리 생성
ensureLogDirectory();

// 로거 생성
export const log: CustomLevels = createLogger({
	levels: customLevels as unknown as winston.config.AbstractConfigSetLevels,
	format: getLogFormat(),
	transports: [
		// 콘솔 출력
		new transports.Console({ 
			level: process.env.LOG_LEVEL || 'Silly',
			handleExceptions: true,
			handleRejections: true
		}),
		
		// 일반 로그 파일
		new DailyRotateFile({
			level: 'Info',
			filename: './logs/%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '30d',
			handleExceptions: true,
			handleRejections: true
		}),
		
		// 에러 로그 파일 (별도)
		new DailyRotateFile({
			level: 'Error',
			filename: './logs/error-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '30d',
			handleExceptions: true,
			handleRejections: true
		}),

		new DailyRotateFile({
			level: 'error',
			filename: './logs/error-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '30d',
			handleExceptions: true,
			handleRejections: true
		})
	],
	
	// 예외 처리
	exceptionHandlers: [
		new transports.File({ filename: './logs/exceptions.log' })
	],
	
	rejectionHandlers: [
		new transports.File({ filename: './logs/rejections.log' })
	],
	
	exitOnError: false
}) as CustomLevels;

// 로거 유틸리티 함수들
export const logger = {
	/**
	 * 성능 측정을 위한 타이머 시작
	 */
	startTimer: (label: string) => {
		const start = process.hrtime.bigint();
		return {
			end: () => {
				const end = process.hrtime.bigint();
				const duration = Number(end - start) / 1000000; // ms로 변환
				log.Debug(`⏱️ ${label} completed in ${duration.toFixed(2)}ms`);
				return duration;
			}
		};
	},

	/**
	 * HTTP 요청 로깅
	 */
	httpRequest: (method: string, url: string, statusCode: number, duration: number) => {
		const level = statusCode >= 400 ? 'Error' : statusCode >= 300 ? 'Warn' : 'Info';
		log[level](`${method} ${url} ${statusCode} - ${duration}ms`);
	},

	/**
	 * 데이터베이스 쿼리 로깅
	 */
	dbQuery: (query: string, duration?: number, params?: any) => {
		const message = duration ? `${query} (${duration}ms)` : query;
		log.SQL(message, params ? { params } : undefined);
	}
};

export default log;
