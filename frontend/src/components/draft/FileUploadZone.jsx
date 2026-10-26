import { useRef, useState } from 'react';
import './FileUploadZone.css';

const ACCEPT = '.pdf,.docx,.txt';
const MAX_BYTES = 20 * 1024 * 1024;

export default function FileUploadZone({ file, onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  function pick(f) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError('File exceeds 20 MB limit.');
      return;
    }
    setError('');
    onFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  }

  return (
    <div className="fuz-wrapper">
      <div
        className={`fuz-zone${dragging ? ' fuz-zone--over' : ''}${file ? ' fuz-zone--has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Drop draft file or click to browse"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="fuz-input"
          onChange={(e) => pick(e.target.files[0])}
        />

        {file ? (
          <div className="fuz-file-info">
            <span className="fuz-file-icon" aria-hidden="true">📎</span>
            <div>
              <div className="fuz-file-name">{file.name}</div>
              <div className="fuz-file-size">{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            <button
              type="button"
              className="btn btn-secondary fuz-remove"
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              aria-label="Remove file"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="fuz-prompt">
            <span className="fuz-upload-icon" aria-hidden="true">📂</span>
            <span className="fuz-label">Drag & drop or click to browse</span>
            <span className="fuz-hint">PDF · DOCX · TXT · max 20 MB</span>
          </div>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
