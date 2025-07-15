import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { log } from '../external/winston';

/**
 * Static file serving middleware for development documentation assets
 * Only serves files when AUTO_DOCS=true
 */
export class StaticFileMiddleware {
    private static staticPath = path.join(__dirname, 'static');
    
    /**
     * Check if static file serving is enabled
     */
    private static isEnabled(): boolean {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const autoDocsEnabled = process.env.AUTO_DOCS === 'true';
        return isDevelopment && autoDocsEnabled;
    }
    
    /**
     * Get MIME type based on file extension
     */
    private static getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.css':
                return 'text/css';
            case '.js':
                return 'application/javascript';
            case '.html':
                return 'text/html';
            case '.json':
                return 'application/json';
            default:
                return 'text/plain';
        }
    }
    
    /**
     * Serve static files from /src/core/lib/static when AUTO_DOCS=true
     */
    static serveStaticFiles() {
        return (req: Request, res: Response, next: NextFunction) => {
            // Only serve static files if documentation is enabled
            if (!StaticFileMiddleware.isEnabled()) {
                return next();
            }
            
            // Check if this is a request for our static files
            const staticFileExtensions = ['.css', '.js'];
            const ext = path.extname(req.path);
            
            if (!staticFileExtensions.includes(ext)) {
                return next();
            }
            
            // Map the requested file to our static directory
            const fileName = path.basename(req.path);
            const filePath = path.join(StaticFileMiddleware.staticPath, fileName);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                log.Debug(`Static file not found: ${filePath}`);
                return next();
            }
            
            try {
                // Read and serve the file
                const fileContent = fs.readFileSync(filePath);
                const mimeType = StaticFileMiddleware.getMimeType(filePath);
                
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'no-cache'); // Disable caching for development
                res.send(fileContent);
                
                log.Debug(`Served static file: ${fileName}`, { path: req.path, size: fileContent.length });
            } catch (error) {
                log.Error(`Failed to serve static file: ${fileName}`, { error, path: req.path });
                next();
            }
        };
    }
    
    /**
     * Get list of available static files
     */
    static getAvailableFiles(): string[] {
        if (!StaticFileMiddleware.isEnabled()) {
            return [];
        }
        
        try {
            return fs.readdirSync(StaticFileMiddleware.staticPath)
                .filter(file => ['.css', '.js'].includes(path.extname(file)));
        } catch (error) {
            log.Error('Failed to read static files directory', { error });
            return [];
        }
    }
    
    /**
     * Check if a specific static file exists
     */
    static fileExists(fileName: string): boolean {
        if (!StaticFileMiddleware.isEnabled()) {
            return false;
        }
        
        const filePath = path.join(StaticFileMiddleware.staticPath, fileName);
        return fs.existsSync(filePath);
    }
}
