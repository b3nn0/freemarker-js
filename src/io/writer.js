// Writer-like output sink + in-memory StringWriter. Sync only.

/** In-memory character sink used when no writer is supplied. */
export class StringWriter {
  /** Creates an empty buffer. */
  constructor() {
    this._chunks = [];
    this._closed = false;
  }

  /**
   * @param {string} chunk
   * @throws {Error} when closed
   */
  write(chunk) {
    if (this._closed) throw new Error('Stream closed');
    this._chunks.push(String(chunk));
  }

  /** No-op marker; nothing is flushed in memory. @returns {void} */
  close() {
    this._closed = true;
  }

  /** @returns {string} everything written so far */
  getAsString() {
    return this._chunks.join('');
  }
}
