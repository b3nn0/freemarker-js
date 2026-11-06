// Writer-like output sink + in-memory StringWriter. Sync only.

export class StringWriter {
  constructor() {
    this._chunks = [];
    this._closed = false;
  }

  write(chunk) {
    if (this._closed) throw new Error('Stream closed');
    this._chunks.push(String(chunk));
  }

  close() {
    this._closed = true;
  }

  getAsString() {
    return this._chunks.join('');
  }
}
