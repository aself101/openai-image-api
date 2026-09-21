/**
 * OpenAI Image Service Utility Functions
 *
 * Utility functions for OpenAI image generation: file I/O, input-image and
 * output-path validation, SSE parsing, filename generation, and the CLI
 * spinner.
 *
 * Removed in 3.0.0: `validateImageUrl`, `downloadImage`, `imageToBase64`,
 * `validateImageFile`, `pause`. The first three existed to fetch DALL-E
 * `url`-format responses; GPT Image models return base64 only, so the package
 * no longer performs any outbound fetch other than the API call itself, and the
 * SSRF guard that protected those fetches went with them. The last two had no
 * caller in any released version.
 */
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import winston from 'winston';
// Configure module logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
        return `${String(timestamp)} - ${level.toUpperCase()} - ${String(message)}`;
    })),
    transports: [new winston.transports.Console()],
});
/**
 * Set the logging level.
 *
 * @param level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export function setLogLevel(level) {
    logger.level = toWinstonLevel(level);
}
/**
 * Map this package's LogLevel names to winston's npm levels.
 *
 * winston has `warn`, not `warning`. Assigning an unknown level name to a
 * winston logger does not fall back — it silences every transport, errors
 * included. Through 3.0.0 `logLevel: 'WARNING'` (the documented value, and
 * the library default since 3.0.0) did exactly that. Every logger in this
 * package must go through this function.
 *
 * @param level - DEBUG | INFO | WARNING | WARN | ERROR, any case
 * @returns The winston level string
 * @throws Error For a name that is none of those, rather than silently muting
 */
export function toWinstonLevel(level) {
    switch (level.toUpperCase()) {
        case 'DEBUG':
            return 'debug';
        case 'INFO':
            return 'info';
        case 'WARNING':
        case 'WARN':
            return 'warn';
        case 'ERROR':
            return 'error';
        default:
            throw new Error(`Unknown log level "${level}". Valid options: DEBUG, INFO, WARNING, ERROR`);
    }
}
/** Module-level logger shared by the CLI and utilities; level set via setLogLevel */
export { logger };
/**
 * Extract a printable message from whatever was thrown.
 *
 * `catch (error)` binds `unknown` under strict mode; casting it to `Error`
 * crashes inside the error handler if a dependency throws a string or null.
 *
 * @param error - The caught value
 * @returns The Error's message, or the value stringified
 */
export function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error) ?? String(error);
    }
    catch {
        return String(error);
    }
}
/**
 * Extract a Node errno code from a caught value, if it carries one.
 */
export function getErrorCode(error) {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = error.code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}
/**
 * Open an input image and check it is non-empty, within the size limit, and
 * carries the magic bytes of a format the Image API accepts (PNG, JPEG, WebP).
 *
 * The handle is returned OPEN so the caller can upload from it. Doing the
 * check and the read on one descriptor closes the window in which a path
 * could be swapped between validation and upload. The caller owns the handle:
 * close it, or read it to the end through a stream created with autoClose.
 *
 * Only the first 12 bytes are read for the check. GIF is not accepted — the
 * API's documented input formats are png, webp, jpg.
 *
 * @param filepath - Path to image file
 * @param maxSize - Maximum file size in bytes (default 50 MB, the API limit)
 * @returns The open, validated image
 * @throws Error If the file is missing, unreadable, a directory, empty, too large, or not an image
 */
export async function openValidatedImage(filepath, maxSize = 50 * 1024 * 1024) {
    let handle;
    try {
        handle = await fs.open(filepath, 'r');
        const { size } = await handle.stat();
        if (size === 0) {
            throw new Error(`Image file is empty: ${filepath}`);
        }
        if (size > maxSize) {
            const mb = (n) => (n / (1024 * 1024)).toFixed(1);
            throw new Error(`Image file ${filepath} is ${mb(size)}MB; the limit is ${mb(maxSize)}MB`);
        }
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, 12, 0);
        const magic = header.subarray(0, bytesRead);
        let mimeType;
        if (magic.length >= 4 && magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47) {
            mimeType = 'image/png';
        }
        else if (magic.length >= 3 && magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) {
            mimeType = 'image/jpeg';
        }
        else if (magic.length >= 12 &&
            magic.subarray(0, 4).toString() === 'RIFF' &&
            magic.subarray(8, 12).toString() === 'WEBP') {
            mimeType = 'image/webp';
        }
        if (!mimeType) {
            throw new Error(`File does not appear to be a valid image (PNG, JPEG, or WebP): ${filepath}`);
        }
        const validated = { handle, size, mimeType, filename: multipartFilename(filepath), path: filepath };
        handle = undefined; // ownership passes to the caller
        return validated;
    }
    catch (error) {
        const code = getErrorCode(error);
        if (code === 'ENOENT') {
            throw new Error(`Image file not found: ${filepath}`, { cause: error });
        }
        else if (code === 'EACCES') {
            throw new Error(`Permission denied reading image file: ${filepath}`, { cause: error });
        }
        else if (code === 'EISDIR') {
            throw new Error(`Image path is a directory, not a file: ${filepath}`, { cause: error });
        }
        throw error;
    }
    finally {
        await handle?.close();
    }
}
/**
 * Validate that a file exists, is non-empty, is within a size limit, and is a
 * PNG, JPEG or WebP — then close it. Use openValidatedImage() when the bytes
 * will be uploaded, so the check and the upload share one descriptor.
 *
 * @param filepath - Path to image file
 * @param maxSize - Maximum file size in bytes (default 50 MB, the API limit)
 * @returns The validated filepath
 * @throws Error If the file is missing, unreadable, empty, too large, or not an image
 */
export async function validateImagePath(filepath, maxSize = 50 * 1024 * 1024) {
    const image = await openValidatedImage(filepath, maxSize);
    await image.handle.close();
    return image.path;
}
/**
 * Close a validated image's handle, tolerating one that a stream has already
 * closed (autoClose) — the second close rejects with EBADF and that is fine.
 *
 * @param image - The image to release
 */
export async function closeValidatedImage(image) {
    await image.handle.close().catch(() => undefined);
}
/**
 * Validate output path for path traversal attacks.
 *
 * @param outputPath - Path to validate
 * @param basePath - Optional base path that output must be within
 * @returns The resolved absolute path
 * @throws Error if path contains traversal sequences or escapes base path
 */
export function validateOutputPath(outputPath, basePath) {
    // Reject a `..` path SEGMENT, not the substring: `my..dir` is a legal name.
    // Both separators are split on so a Windows-style path is checked the same way.
    if (outputPath.split(/[\\/]+/).includes('..')) {
        throw new Error('Path traversal sequences (..) are not allowed in output paths');
    }
    // Resolve to absolute path
    const resolved = path.resolve(outputPath);
    // If base path provided, ensure output stays within it
    if (basePath) {
        const resolvedBase = path.resolve(basePath);
        if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
            throw new Error(`Output path must be within ${basePath}`);
        }
    }
    return resolved;
}
/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    }
    catch (error) {
        const message = getErrorMessage(error);
        logger.error(`Error creating directory ${dirPath}: ${message}`);
        throw error;
    }
}
/**
 * Write data to file.
 *
 * @param data - Data to write (Object, Array, Buffer, string, etc.)
 * @param filepath - Path where file should be written (no `..` segments)
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 * @throws Error If the path contains a `..` segment, or a binary write is given a non-Buffer
 * @example
 * await writeToFile({ model, prompt, usage }, 'out/render_metadata.json'); // 'auto' → JSON
 */
export async function writeToFile(data, filepath, fileFormat = 'auto') {
    if (!filepath) {
        throw new Error('Filepath is required');
    }
    // Same rule as decodeBase64Image: no `..` segment reaches the filesystem
    validateOutputPath(filepath);
    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filepath);
        await ensureDirectory(dir);
        // Auto-detect format from extension
        let format = fileFormat;
        if (format === 'auto') {
            const ext = path.extname(filepath).toLowerCase();
            if (ext === '.json') {
                format = 'json';
            }
            else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
                format = 'binary';
            }
            else {
                format = 'txt';
            }
        }
        // Write based on format
        if (format === 'json') {
            await fs.writeFile(filepath, JSON.stringify(data, null, 2));
        }
        else if (format === 'binary') {
            if (!Buffer.isBuffer(data)) {
                throw new Error(`Binary write to ${filepath} requires a Buffer, got ${typeof data}`);
            }
            await fs.writeFile(filepath, data);
        }
        else {
            await fs.writeFile(filepath, String(data));
        }
        logger.debug(`Wrote file: ${filepath}`);
    }
    catch (error) {
        const message = getErrorMessage(error);
        logger.error(`Error writing file ${filepath}: ${message}`);
        throw error;
    }
}
/**
 * Decode base64 image data and save to file.
 *
 * `filepath` is passed through validateOutputPath first: a `..` segment is
 * refused, and the returned path is the resolved absolute path that was
 * written. Callers who build the path from untrusted input still own the
 * decision of which directory it lands in; `saveImages()` adds the
 * single-component check on the filename.
 *
 * @param b64Data - Base64 encoded image data
 * @param filepath - Destination file path (no `..` segments)
 * @returns The resolved path the image was written to
 * @throws Error If the path contains a `..` segment or the write fails
 */
export async function decodeBase64Image(b64Data, filepath) {
    const resolved = validateOutputPath(filepath);
    try {
        logger.debug(`Decoding base64 image to ${resolved}`);
        await ensureDirectory(path.dirname(resolved));
        const buffer = Buffer.from(b64Data, 'base64');
        await fs.writeFile(resolved, buffer);
        logger.info(`Saved base64 image: ${resolved}`);
        return resolved;
    }
    catch (error) {
        const message = getErrorMessage(error);
        logger.error(`Error decoding base64 image: ${message}`);
        throw new Error(`Failed to decode base64 image: ${message}`, { cause: error });
    }
}
/**
 * Sanitize text for use in filenames.
 *
 * @param text - Text to sanitize
 * @param maxLength - Maximum length of sanitized text
 * @returns Sanitized text safe for filenames
 */
export function sanitizeForFilename(text, maxLength = 50) {
    // Letters and digits in any script are kept, so a Japanese or Cyrillic prompt
    // does not collapse to an empty stem; everything else becomes one underscore.
    const stem = text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, maxLength);
    // Windows refuses these as file stems regardless of extension
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `${stem}_` : stem;
}
/**
 * Assert that a caller-supplied base filename is a single path component.
 *
 * `saveImages()` joins this with the output directory; a value carrying a
 * separator or `..` would let a server that forwards end-user input into the
 * SDK write outside the directory it chose. Rejected rather than sanitized so
 * the caller learns about it.
 *
 * @param name - Proposed base filename (without extension)
 * @returns The same name
 * @throws Error If the name is empty, contains a path separator, or is `.`/`..`
 */
export function assertSafeBaseFilename(name) {
    if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
        throw new Error(`baseFilename must be a single path component, got "${name}"`);
    }
    return name;
}
/**
 * Multipart part filename derived from a path: the basename with CR, LF and
 * double quotes replaced, so a hostile path cannot inject header lines into
 * the multipart body regardless of the form-data version in use.
 *
 * @param filePath - Path of the file being uploaded
 * @returns A header-safe filename
 */
export function multipartFilename(filePath) {
    const base = path.basename(filePath).replace(/[\r\n"]/g, '_');
    return base || 'image';
}
/**
 * Generate filename from prompt text.
 *
 * @param prompt - The image generation prompt
 * @param maxLength - Maximum length of filename part
 * @returns Sanitized filename-safe string
 */
export function promptToFilename(prompt, maxLength = 50) {
    return sanitizeForFilename(prompt, maxLength);
}
/**
 * Generate timestamped filename with prompt.
 *
 * @param prompt - The image generation prompt
 * @param model - Model name (e.g. gpt-image-2.5-flare)
 * @param extension - File extension (png, jpg, webp)
 * @returns `YYYY-MM-DD_HH-MM-SS-mmm_<4 hex>_<model>_<prompt stem>.<extension>`
 * @example
 * generateTimestampedFilename('A cat!', 'gpt-image-2', 'webp');
 * // → '2026-09-20_22-37-00-123_4f2a_gpt-image-2_a_cat.webp'
 */
export function generateTimestampedFilename(prompt, model, extension = 'png') {
    // ISO 8601 is always "YYYY-MM-DDTHH:MM:SS.mmmZ"; keep date, HH-MM-SS and ms.
    // Millisecond resolution plus a 4-hex random tail keeps two processes that
    // render the same prompt in the same second from overwriting each other.
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    const timestamp = `${iso.slice(0, 10)}_${iso.slice(11, 23)}`;
    const nonce = randomBytes(2).toString('hex');
    const promptPart = promptToFilename(prompt, 40) || 'prompt';
    return `${timestamp}_${nonce}_${model}_${promptPart}.${extension}`;
}
/**
 * Create a simple text-based spinner for CLI.
 *
 * @param message - Message to display
 * @returns Spinner object with update() and stop() methods
 */
export function createSpinner(message = 'Processing') {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    let interval = null;
    const startTime = Date.now();
    let currentMessage = message;
    const spinner = {
        start() {
            process.stdout.write('\n');
            interval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const frame = frames[frameIndex];
                frameIndex = (frameIndex + 1) % frames.length;
                process.stdout.write(`\r${frame} ${currentMessage}... (${elapsed}s elapsed)`);
            }, 80);
            return this;
        },
        update(newMessage) {
            currentMessage = newMessage;
            return this;
        },
        stop(finalMessage = undefined) {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (finalMessage) {
                process.stdout.write(`\r✓ ${finalMessage} (${elapsed}s)\n`);
            }
            else {
                process.stdout.write(`\r✓ ${currentMessage} complete (${elapsed}s)\n`);
            }
            return this;
        },
        fail(errorMessage = undefined) {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            if (errorMessage) {
                process.stdout.write(`\r✗ ${errorMessage}\n`);
            }
            else {
                process.stdout.write(`\r✗ ${currentMessage} failed\n`);
            }
            return this;
        },
    };
    return spinner;
}
// =============================================================================
// SERVER-SENT EVENTS
// =============================================================================
/**
 * Parse a Server-Sent Events byte stream into discrete events.
 *
 * Implements the subset of the SSE wire format the Image API emits: events are
 * separated by a blank line, each carrying an `event:` line and one or more
 * `data:` lines. Comment lines (`:`) and unknown fields are ignored. A trailing
 * event with no terminating blank line is flushed when the stream ends, so a
 * server that closes the connection immediately after the final event is not
 * mis-read as having sent nothing.
 *
 * Image payloads are large (a `max`-quality PNG is several megabytes of base64
 * in a single `data:` line), so chunks are accumulated as strings and only
 * split on the event delimiter. The accumulation is bounded: an event that
 * grows past `maxEventBytes` without a delimiter fails the stream instead of
 * growing until the process is out of memory — the bound is far above any real
 * image (128 MiB default, versus tens of MB for a 4K `max` render) and exists
 * for a hostile or broken upstream, not a legitimate one.
 *
 * @param stream - Readable emitting UTF-8 SSE bytes
 * @param maxEventBytes - Ceiling on a single undelimited event (default 128 MiB)
 * @returns Async generator of raw events in arrival order
 * @throws Error If one event exceeds maxEventBytes
 */
export const SSE_MAX_EVENT_BYTES = 128 * 1024 * 1024;
export async function* parseSSEStream(stream, maxEventBytes = SSE_MAX_EVENT_BYTES) {
    let buffer = '';
    // Where the next boundary search starts. Without it every chunk rescans the
    // whole buffer, which is quadratic on a multi-megabyte single-line payload;
    // backing up three characters covers a delimiter split across chunks.
    let scanFrom = 0;
    const flush = (block) => {
        let event;
        const data = [];
        for (const rawLine of block.split('\n')) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line === '' || line.startsWith(':'))
                continue;
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            // The spec strips exactly one leading space after the colon
            let value = colon === -1 ? '' : line.slice(colon + 1);
            if (value.startsWith(' '))
                value = value.slice(1);
            if (field === 'event')
                event = value;
            else if (field === 'data')
                data.push(value);
        }
        if (data.length === 0 && event === undefined)
            return null;
        return { event, data: data.join('\n') };
    };
    for await (const chunk of stream) {
        buffer += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (buffer.length > maxEventBytes) {
            stream.destroy();
            throw new Error(`SSE event exceeded ${maxEventBytes} bytes without a delimiter; aborting stream`);
        }
        // Events end at a blank line; tolerate CRLF, LF, and a mixed pair
        const delimiter = /\r?\n\r?\n/g;
        delimiter.lastIndex = Math.max(0, scanFrom - 3);
        let match;
        while ((match = delimiter.exec(buffer)) !== null) {
            const block = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            delimiter.lastIndex = 0;
            const parsed = flush(block);
            if (parsed)
                yield parsed;
        }
        scanFrom = buffer.length;
    }
    if (buffer.trim().length > 0) {
        const parsed = flush(buffer);
        if (parsed)
            yield parsed;
    }
}
/**
 * Read an entire stream into a UTF-8 string.
 *
 * Used to recover an error body when a streaming request fails: axios hands
 * back `response.data` as a Readable in stream mode, so the JSON error the API
 * returned must be drained before it can be reported.
 *
 * @param stream - Readable to drain
 * @param maxBytes - Refuse to buffer more than this (default 1 MiB)
 * @returns The stream's bytes decoded as UTF-8
 */
export async function readStreamToString(stream, maxBytes = 1024 * 1024) {
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
        total += buf.length;
        if (total > maxBytes) {
            throw new Error(`Stream exceeded ${maxBytes} bytes while reading error body`);
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
}
//# sourceMappingURL=utils.js.map