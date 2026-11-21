import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import type { HostType } from "@mybrand/shared";
import { startBootJob } from "../../api/hostApi";
import {
  encodeImageFileForIntake,
  formatBytes,
  type EncodedIntakeImage,
} from "../../utils/imageUpload";
import {
  MAX_INTAKE_IMAGES,
  normalizeIntakeUrl,
  validateIntake,
} from "../../utils/intakeValidation";

interface HostIntakePageProps {
  onNavigate: (path: string) => void;
}

export function HostIntakePage({ onNavigate }: HostIntakePageProps) {
  const [hostName, setHostName] = useState("");
  const [hostType, setHostType] = useState<HostType>("person");
  const [images, setImages] = useState<EncodedIntakeImage[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [voiceSamples, setVoiceSamples] = useState<string[]>([]);
  const [voiceInput, setVoiceInput] = useState("");

  const [dragActive, setDragActive] = useState(false);
  const [processingImages, setProcessingImages] = useState(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList).filter((f) =>
        f.type.startsWith("image/")
      );
      if (incoming.length === 0) {
        setImageNotice("Please drop or choose image files (JPG, PNG, WebP).");
        return;
      }

      const remainingSlots = MAX_INTAKE_IMAGES - images.length;
      if (remainingSlots <= 0) {
        setImageNotice(
          `Limit reached: up to ${MAX_INTAKE_IMAGES} images can be uploaded.`
        );
        return;
      }

      const toProcess = incoming.slice(0, remainingSlots);
      const skippedCount = incoming.length - toProcess.length;

      setProcessingImages(true);
      setImageNotice(null);

      const encoded: EncodedIntakeImage[] = [];
      const failedNames: string[] = [];

      for (const file of toProcess) {
        try {
          const item = await encodeImageFileForIntake(file);
          encoded.push(item);
        } catch {
          failedNames.push(file.name);
        }
      }

      if (encoded.length > 0) {
        setImages((prev) =>
          [...prev, ...encoded].slice(0, MAX_INTAKE_IMAGES)
        );
      }

      const notices: string[] = [];
      if (skippedCount > 0) {
        notices.push(
          `Skipped ${skippedCount} extra image${skippedCount === 1 ? "" : "s"} (max ${MAX_INTAKE_IMAGES}).`
        );
      }
      if (failedNames.length > 0) {
        notices.push(`Could not process: ${failedNames.join(", ")}.`);
      }
      if (notices.length > 0) {
        setImageNotice(notices.join(" "));
      }

      setProcessingImages(false);
    },
    [images.length]
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pastedFiles = Array.from(event.clipboardData.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFiles(pastedFiles);
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((item) => item.id !== id));
    setImageNotice(null);
  };

  const handleAddUrl = () => {
    const res = normalizeIntakeUrl(urlInput);
    if (!res.ok) {
      setUrlError(res.error);
      return;
    }
    if (urls.includes(res.url)) {
      setUrlError("That URL is already in the list.");
      return;
    }
    setUrls((prev) => [...prev, res.url]);
    setUrlInput("");
    setUrlError(null);
  };

  const handleRemoveUrl = (urlToRemove: string) => {
    setUrls((prev) => prev.filter((u) => u !== urlToRemove));
  };

  const handleAddVoiceSample = () => {
    const trimmed = voiceInput.trim();
    if (!trimmed) return;
    setVoiceSamples((prev) => [...prev, trimmed]);
    setVoiceInput("");
  };

  const handleRemoveVoiceSample = (index: number) => {
    setVoiceSamples((prev) => prev.filter((_, idx) => idx !== index));
  };

  const validation = useMemo(
    () =>
      validateIntake({
        hostName,
        hostType,
        imageCount: images.length,
        urls,
        voiceSamples,
        pendingUrlDraft: urlInput,
        pendingVoiceDraft: voiceInput,
      }),
    [hostName, hostType, images.length, urls, voiceSamples, urlInput, voiceInput]
  );

  const totalUploadBytes = useMemo(
    () => images.reduce((sum, item) => sum + item.sizeBytes, 0),
    [images]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validation.valid || processingImages || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await startBootJob({
        hostName: hostName.trim(),
        hostType,
        images: images.map((img) => ({
          filename: img.filename,
          mimeType: img.mimeType,
          dataBase64: img.dataBase64,
        })),
        urls: validation.effectiveUrls,
        voiceSamples: validation.effectiveVoiceSamples,
      });

      onNavigate(`/host/${encodeURIComponent(response.bootId)}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <main className="host-intake-page" onPaste={handlePaste}>
      <div className="host-intake-container">
        <header className="host-topbar-nav">
          <button
            type="button"
            className="ghost-nav-btn"
            onClick={() => onNavigate("/")}
          >
            ← Back to Lobby
          </button>
          <span className="host-nav-tag">MyBrand · Host Studio (Phase 0)</span>
        </header>

        <div className="host-intake-intro">
          <p className="landing-eyebrow">Create a Boutique</p>
          <h1 className="host-intake-title">
            Turn your material into an adaptive 3D boutique
          </h1>
          <p className="host-intake-lead">
            Drop photos of your work, add your websites or social links, and
            paste a few examples of how you speak. The Gemini 4 Boot agent will
            craft your brand strategy, product line, 3D world, and live
            adaptation rules.
          </p>
        </div>

        <form className="host-intake-form" onSubmit={handleSubmit}>
          {/* 1. Host Identity */}
          <section className="intake-card">
            <div className="intake-card-head">
              <h2>1. Who is this boutique for?</h2>
              <span className="intake-required-pill">Required</span>
            </div>

            <div className="intake-identity-grid">
              <label className="intake-field">
                <span className="intake-label">Host or Brand Name</span>
                <input
                  type="text"
                  className="intake-input"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Maren Solis, Kestrel & Clay, Harbor Surf Co."
                  required
                  autoFocus
                />
              </label>

              <div className="intake-field">
                <span className="intake-label">Host Type</span>
                <div
                  className="segmented-toggle"
                  role="radiogroup"
                  aria-label="Host type"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={hostType === "person"}
                    className={`segmented-btn ${hostType === "person" ? "active" : ""}`}
                    onClick={() => setHostType("person")}
                  >
                    <strong>Person</strong>
                    <span>Creator, artist, maker</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={hostType === "company"}
                    className={`segmented-btn ${hostType === "company" ? "active" : ""}`}
                    onClick={() => setHostType("company")}
                  >
                    <strong>Company</strong>
                    <span>Studio, shop, brand</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Photos / Visual Material */}
          <section className="intake-card">
            <div className="intake-card-head">
              <div>
                <h2>2. Visual Material</h2>
                <p className="intake-hint">
                  Upload up to {MAX_INTAKE_IMAGES} photos of your work, studio,
                  aesthetic, or world. Ideal: 8–20 photos. Large images are
                  automatically resized client-side for fast upload.
                </p>
              </div>
              <span className="intake-count-pill">
                {images.length} / {MAX_INTAKE_IMAGES}
              </span>
            </div>

            <div
              className={`image-dropzone ${dragActive ? "drag-active" : ""} ${images.length >= MAX_INTAKE_IMAGES ? "full" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (images.length < MAX_INTAKE_IMAGES) {
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  images.length < MAX_INTAKE_IMAGES
                ) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Upload photos"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <div className="dropzone-icon" aria-hidden="true">
                ⬆
              </div>
              <div className="dropzone-title">
                {processingImages
                  ? "Optimizing photos…"
                  : images.length >= MAX_INTAKE_IMAGES
                    ? `Maximum ${MAX_INTAKE_IMAGES} photos added`
                    : "Drop photos here, click to browse, or paste from clipboard"}
              </div>
              <div className="dropzone-sub">
                JPG, PNG, or WebP · resized to ≤1280 px automatically
                {images.length > 0 && ` · ${formatBytes(totalUploadBytes)} total`}
              </div>
            </div>

            {imageNotice && <p className="intake-inline-warn">{imageNotice}</p>}

            {images.length > 0 && (
              <div className="intake-thumb-grid">
                {images.map((img, index) => (
                  <div key={img.id} className="intake-thumb-item">
                    <div className="intake-thumb-frame">
                      <img src={img.previewUrl} alt={img.filename} />
                      <button
                        type="button"
                        className="intake-thumb-remove"
                        onClick={() => handleRemoveImage(img.id)}
                        aria-label={`Remove ${img.filename}`}
                        title="Remove image"
                      >
                        ✕
                      </button>
                      <span className="intake-thumb-index">
                        img_{String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="intake-thumb-caption">
                      <span className="intake-thumb-name" title={img.filename}>
                        {img.filename}
                      </span>
                      <span className="intake-thumb-size">
                        {formatBytes(img.sizeBytes)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3. URLs */}
          <section className="intake-card">
            <div className="intake-card-head">
              <div>
                <h2>3. Websites &amp; Links</h2>
                <p className="intake-hint">
                  Add portfolio pages, About pages, newsletters, or existing
                  sites. Ideal: 2–5 URLs. (1+ URL also satisfies the Phase 0
                  minimum alongside or instead of 3+ photos.)
                </p>
              </div>
              <span className="intake-count-pill">{urls.length} added</span>
            </div>

            <div className="intake-add-row">
              <input
                type="text"
                className="intake-input"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
                placeholder="https://yoursite.com/about"
                aria-label="Website URL"
              />
              <button
                type="button"
                className="secondary-cta"
                onClick={handleAddUrl}
              >
                + Add URL
              </button>
            </div>
            {urlError && <p className="intake-inline-err">{urlError}</p>}

            {urls.length > 0 && (
              <ul className="intake-url-list">
                {urls.map((url, idx) => (
                  <li key={url} className="intake-url-row">
                    <span className="intake-item-tag">url_{idx + 1}</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="intake-url-link"
                    >
                      {url}
                    </a>
                    <button
                      type="button"
                      className="intake-remove-btn"
                      onClick={() => handleRemoveUrl(url)}
                      aria-label={`Remove ${url}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 4. Voice Samples */}
          <section className="intake-card">
            <div className="intake-card-head">
              <div>
                <h2>4. Voice Samples</h2>
                <p className="intake-hint">
                  Paste posts, captions, replies to fans, or newsletter excerpts
                  so product copy and live host notes sound unmistakably like
                  you. Ideal: 5–20 short samples.
                </p>
              </div>
              <span className="intake-count-pill">
                {validation.effectiveVoiceSamples.length} sample
                {validation.effectiveVoiceSamples.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="intake-reassurance-box">
              <strong>Never sold a product before?</strong> Totally fine — paste
              posts, captions, replies, or bio notes that capture your voice and
              world. The Boot agent will propose a grounded product line
              (physical goods, digital guides, or services) based on what your
              audience already loves about you.
            </div>

            <div className="intake-voice-composer">
              <textarea
                className="intake-textarea"
                rows={3}
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder="Paste a caption, reply to a fan, newsletter note, or short studio story…"
                aria-label="Voice sample"
              />
              <div className="intake-voice-actions">
                <span className="intake-voice-tip">
                  Tip: Click &ldquo;+ Add sample&rdquo; to queue multiple
                  excerpts (any text left here is also included when you start).
                </span>
                <button
                  type="button"
                  className="secondary-cta"
                  onClick={handleAddVoiceSample}
                  disabled={!voiceInput.trim()}
                >
                  + Add sample
                </button>
              </div>
            </div>

            {voiceSamples.length > 0 && (
              <ul className="intake-voice-list">
                {voiceSamples.map((sample, idx) => (
                  <li key={`${idx}-${sample.slice(0, 16)}`} className="intake-voice-row">
                    <span className="intake-item-tag">voice_{idx + 1}</span>
                    <p className="intake-voice-text">&ldquo;{sample}&rdquo;</p>
                    <button
                      type="button"
                      className="intake-remove-btn"
                      onClick={() => handleRemoveVoiceSample(idx)}
                      aria-label={`Remove voice sample ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Footer Readiness Bar + Start Button */}
          <footer className="intake-submit-bar">
            <div className="intake-readiness">
              <div className="readiness-pills">
                <span
                  className={`readiness-pill ${validation.hasHostName ? "ok" : "missing"}`}
                >
                  {validation.hasHostName ? "✓" : "○"} Host name
                </span>
                <span
                  className={`readiness-pill ${validation.hasMinimumSources ? "ok" : "missing"}`}
                >
                  {validation.hasMinimumSources ? "✓" : "○"} ≥3 photos or ≥1 URL
                  ({images.length} photos · {validation.effectiveUrls.length}{" "}
                  URLs)
                </span>
                <span
                  className={`readiness-pill ${validation.effectiveVoiceSamples.length > 0 ? "ok" : "optional"}`}
                >
                  {validation.effectiveVoiceSamples.length > 0 ? "✓" : "•"}{" "}
                  Voice samples ({validation.effectiveVoiceSamples.length})
                </span>
              </div>
              {submitError && (
                <div className="intake-submit-error" role="alert">
                  Could not start boot: {submitError}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="primary-cta intake-start-btn"
              disabled={!validation.valid || processingImages || submitting}
            >
              {submitting
                ? "Starting Boot agent…"
                : "Start Boutique Boot →"}
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}
