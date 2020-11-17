/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

/* global MediaStreamTrackProcessor, MediaStreamTrackGenerator */
if (typeof MediaStreamTrackProcessor === 'undefined' ||
    typeof MediaStreamTrackGenerator === 'undefined') {
  alert(
      'Your browser does not support the experimental MediaStreamTrack API ' +
      'for Insertable Streams of Media. See the note at the bottom of the ' +
      'page.');
}

/**
 * Allows inspecting objects in the console. See console log messages for
 * attributes added to this debug object.
 * @type {!Object<string,*>}
 */
let debug = {};

/**
 * FrameTransformFn applies a transform to a frame and queues the output frame
 * (if any) using the controller. The first argument is the input frame and the
 * second argument is the stream controller.
 * The VideoFrame should be destroyed as soon as it is no longer needed to free
 * resources and maintain good performance.
 * @typedef {function(
 *     !VideoFrame,
 *     !TransformStreamDefaultController<!VideoFrame>): undefined}
 */
let FrameTransformFn; // eslint-disable-line no-unused-vars

/**
 * Creates a pair of MediaStreamTrackProcessor and MediaStreamTrackGenerator
 * that applies transform to sourceTrack. This function is the core part of the
 * sample, demonstrating how to use the new API.
 * @param {!MediaStreamTrack} sourceTrack the video track to be transformed. The
 *     track can be from any source, e.g. getUserMedia, RTCTrackEvent, or
 * captureStream on HTMLMediaElement or HTMLCanvasElement.
 * @param {!FrameTransformFn} transform the transform to apply to sourceTrack;
 *     the transformed frames are available on the returned track. See the
 *     implementations of FrameTransform.transform later in this file for
 *     examples.
 * @return {!MediaStreamTrack} the result of sourceTrack transformed using
 *     transform.
 */
function createProcessedMediaStreamTrack(sourceTrack, transform) {
  // Create the MediaStreamTrackProcessor.
  /** @type {?MediaStreamTrackProcessor<!VideoFrame>} */
  let processor;
  try {
    processor = new MediaStreamTrackProcessor(sourceTrack);
  } catch (e) {
    alert(`MediaStreamTrackProcessor failed: ${e}`);
    throw e;
  }

  // Create the MediaStreamTrackGenerator.
  /** @type {?MediaStreamTrackGenerator<!VideoFrame>} */
  let generator;
  try {
    generator = new MediaStreamTrackGenerator('video');
  } catch (e) {
    alert(`MediaStreamTrackGenerator failed: ${e}`);
    throw e;
  }

  const source = processor.readable;
  const sink = generator.writable;

  // Create a TransformStream using our FrameTransformFn. (Note that the
  // "Stream" in TransformStream refers to the Streams API, specified by
  // https://streams.spec.whatwg.org/, not the Media Capture and Streams API,
  // specified by https://w3c.github.io/mediacapture-main/.)
  /** @type {!TransformStream<!VideoFrame, !VideoFrame>} */
  const transformer = new TransformStream({transform});

  // Apply the transform to the processor's stream and send it to the
  // generator's stream.
  source.pipeThrough(transformer).pipeTo(sink);

  debug['processor'] = processor;
  debug['generator'] = generator;
  debug['transformStream'] = transformer;
  console.log(
      '[createProcessedMediaStreamTrack] Created MediaStreamTrackProcessor, ' +
          'MediaStreamTrackGenerator, and TransformStream.',
      'debug.processor =', processor, 'debug.generator =', generator,
      'debug.transformStream =', transformer);

  return generator;
}

/**
 * Wrapper around createProcessedMediaStreamTrack to apply transform to a
 * MediaStream.
 * @param {!MediaStream} sourceStream the video stream to be transformed. The
 *     first video track will be used.
 * @param {!FrameTransformFn} transform the transform to apply to the
 *     sourceStream.
 * @return {!MediaStream} holds a single video track of the transformed video
 *     frames
 */
function createProcessedMediaStream(sourceStream, transform) {
  // For this sample, we're only dealing with video tracks.
  /** @type {!MediaStreamTrack} */
  const sourceTrack = sourceStream.getVideoTracks()[0];

  const processedTrack =
      createProcessedMediaStreamTrack(sourceTrack, transform);

  // Create a new MediaStream to hold our processed track.
  const processedStream = new MediaStream();
  processedStream.addTrack(processedTrack);

  return processedStream;
}

/**
 * Interface implemented by all video sources the user can select. A common
 * interface allows the user to choose a source independently of the transform
 * and sink.
 * @interface
 */
class MediaStreamSource { // eslint-disable-line no-unused-vars
  /**
   * Sets the path to this object from the debug global var.
   * @param {string} path
   */
  setDebugPath(path) {}
  /**
   * Indicates if the source video should be mirrored/displayed on the page. If
   * false (the default), any element producing frames will not be a child of
   * the document.
   * @param {boolean} visible whether to add the raw source video to the page
   */
  setVisibility(visible) {}
  /**
   * Initializes and returns the MediaStream for this source.
   * @return {!Promise<!MediaStream>}
   */
  async getMediaStream() {}
  /** Frees any resources used by this object. */
  destroy() {}
}

/**
 * Interface implemented by all video transforms that the user can select. A
 * common interface allows the user to choose a transform independently of the
 * source and sink.
 * @interface
 */
class FrameTransform { // eslint-disable-line no-unused-vars
  /** Initializes state that is reused across frames. */
  async init() {}
  /**
   * Applies the transform to frame. Queues the output frame (if any) using the
   * controller.
   * @param {!VideoFrame} frame the input frame
   * @param {!TransformStreamDefaultController<!VideoFrame>} controller
   */
  async transform(frame, controller) {}
  /** Frees any resources used by this object. */
  destroy() {}
}

/**
 * Interface implemented by all video sinks that the user can select. A common
 * interface allows the user to choose a sink independently of the source and
 * transform.
 * @interface
 */
class MediaStreamSink { // eslint-disable-line no-unused-vars
  /**
   * @param {!MediaStream} stream
   */
  async setMediaStream(stream) {}
  /** Frees any resources used by this object. */
  destroy() {}
}

/**
 * Assebles a MediaStreamSource, FrameTransform, and MediaStreamSink together.
 */
class Pipeline {
  constructor() {
    /** @private {?MediaStreamSource} set by updateSource*/
    this.source_ = null;
    /** @private {?FrameTransform} set by updateTransform */
    this.frameTransform_ = null;
    /** @private {?MediaStreamSink} set by updateSink */
    this.sink_ = null;
    /**
     * @private {?MediaStream} set in maybeStartPipeline_ after all of source_,
     *     frameTransform_, and sink_ are set
     */
    this.processedStream_ = null;
  }

  /** @return {?MediaStreamSource} */
  getSource() {
    return this.source_;
  }

  /**
   * Sets a new source for the pipeline.
   * @param {!MediaStreamSource} mediaStreamSource
   */
  async updateSource(mediaStreamSource) {
    if (this.source_) {
      this.source_.destroy();
      this.processedStream_ = null;
    }
    this.source_ = mediaStreamSource;
    this.source_.setDebugPath('debug.pipeline.source_');
    console.log(
        '[Pipeline] Updated source.',
        'debug.pipeline.source_ = ', this.source_);
    await this.maybeStartPipeline_();
  }

  /** @private */
  async maybeStartPipeline_() {
    if (this.processedStream_ || !this.source_ || !this.frameTransform_ ||
        !this.sink_) {
      return;
    }
    const sourceStream = await this.source_.getMediaStream();
    await this.frameTransform_.init();
    try {
      this.processedStream_ =
          createProcessedMediaStream(sourceStream, (frame, controller) => {
            // this.frameTransform_?.transform(frame, controller);
            if (this.frameTransform_) {
              this.frameTransform_.transform(frame, controller);
            }
          });
    } catch (e) {
      this.destroy();
      return;
    }
    await this.sink_.setMediaStream(this.processedStream_);
    console.log('[Pipeline] Pipeline started.');
  }

  /**
   * Sets a new transform for the pipeline.
   * @param {!FrameTransform} frameTransform
   */
  async updateTransform(frameTransform) {
    if (this.frameTransform_) this.frameTransform_.destroy();
    this.frameTransform_ = frameTransform;
    console.log(
        '[Pipeline] Updated frame transform.',
        'debug.pipeline.frameTransform_ = ', this.frameTransform_);
    if (this.processedStream_) {
      await this.frameTransform_.init();
    } else {
      await this.maybeStartPipeline_();
    }
  }

  /**
   * Sets a new sink for the pipeline.
   * @param {!MediaStreamSink} mediaStreamSink
   */
  async updateSink(mediaStreamSink) {
    if (this.sink_) this.sink_.destroy();
    this.sink_ = mediaStreamSink;
    console.log(
        '[Pipeline] Updated sink.', 'debug.pipeline.sink_ = ', this.sink_);
    if (this.processedStream_) {
      await this.sink_.setMediaStream(this.processedStream_);
    } else {
      await this.maybeStartPipeline_();
    }
  }

  /** Frees any resources used by this object. */
  destroy() {
    console.log('[Pipeline] Destroying Pipeline');
    if (this.source_) this.source_.destroy();
    if (this.frameTransform_) this.frameTransform_.destroy();
    if (this.sink_) this.sink_.destroy();
  }
}

/**
 * The current video pipeline. Initialized by initPipeline().
 * @type {?Pipeline}
 */
let pipeline;

const sourceSelector = /** @type {!HTMLSelectElement} */ (
  document.getElementById('sourceSelector'));
const sourceVisibleCheckbox = (/** @type {!HTMLInputElement} */ (
  document.getElementById('sourceVisible')));
/**
 * Updates the pipeline based on the current settings of the sourceSelector and
 * sourceVisible UI elements. Unlike updatePipelineSource(), never
 * re-initializes the pipeline.
 */
function updatePipelineSourceIfSet() {
  const sourceType = sourceSelector.options[sourceSelector.selectedIndex].value;
  if (!sourceType) return;
  console.log(`[UI] Selected source: ${sourceType}`);
  let source;
  switch (sourceType) {
    case 'camera':
      source = new CameraSource();
      break;
    case 'video':
      source = new VideoSource();
      break;
    case 'pc':
      source = new PeerConnectionSource(new CameraSource());
      break;
    default:
      alert(`unknown source ${sourceType}`);
      return;
  }
  source.setVisibility(sourceVisibleCheckbox.checked);
  pipeline.updateSource(source);
}
/**
 * Updates the pipeline based on the current settings of the sourceSelector and
 * sourceVisible UI elements. If the "stopped" option is selected, reinitializes
 * the pipeline instead.
 */
function updatePipelineSource() {
  const sourceType = sourceSelector.options[sourceSelector.selectedIndex].value;
  if (!sourceType) {
    initPipeline();
  } else {
    updatePipelineSourceIfSet();
  }
}
sourceSelector.oninput = updatePipelineSource;
sourceVisibleCheckbox.oninput = () => {
  console.log(`[UI] Changed source visibility: ${
      sourceVisibleCheckbox.checked ? 'added' : 'removed'}`);
  // pipeline?.getSource()?.setVisibility(sourceVisibleCheckbox.checked);
  if (pipeline) {
    const source = pipeline.getSource();
    if (source) {
      source.setVisibility(sourceVisibleCheckbox.checked);
    }
  }
};

const transformSelector = /** @type {!HTMLSelectElement} */ (
  document.getElementById('transformSelector'));
/**
 * Updates the pipeline based on the current settings of the transformSelector
 * UI element.
 */
function updatePipelineTransform() {
  const transformType =
      transformSelector.options[transformSelector.selectedIndex].value;
  console.log(`[UI] Selected transform: ${transformType}`);
  switch (transformType) {
    case 'webgl':
      pipeline.updateTransform(new WebGLTransform());
      break;
    case 'canvas2d':
      pipeline.updateTransform(new CanvasTransform());
      break;
    case 'drop':
      pipeline.updateTransform(new DropTransform());
      break;
    case 'delay':
      pipeline.updateTransform(new DelayTransform());
      break;
    default:
      alert(`unknown transform ${transformType}`);
      break;
  }
}
transformSelector.oninput = updatePipelineTransform;

const sinkSelector = (/** @type {!HTMLSelectElement} */ (
  document.getElementById('sinkSelector')));
/**
 * Updates the pipeline based on the current settings of the sinkSelector UI
 * element.
 */
function updatePipelineSink() {
  const sinkType = sinkSelector.options[sinkSelector.selectedIndex].value;
  console.log(`[UI] Selected sink: ${sinkType}`);
  switch (sinkType) {
    case 'video':
      pipeline.updateSink(new VideoSink());
      break;
    case 'pc':
      pipeline.updateSink(new PeerConnectionSink());
      break;
    default:
      alert(`unknown sink ${sinkType}`);
      break;
  }
}
sinkSelector.oninput = updatePipelineSink;

/**
 * Initializes/reinitializes the pipeline. Called on page load and after the
 * user chooses to stop the video source.
 */
function initPipeline() {
  if (pipeline) pipeline.destroy();
  pipeline = new Pipeline();
  debug = {pipeline};
  updatePipelineSourceIfSet();
  updatePipelineTransform();
  updatePipelineSink();
  console.log(
      '[initPipeline] Created new Pipeline.', 'debug.pipeline =', pipeline);
}

/**
 * Helper to display a MediaStream in an HTMLVideoElement, based on the
 * visibility setting.
 */
class VideoMirrorHelper {
  constructor() {
    /** @private {boolean} */
    this.visibility_ = false;
    /** @private {?MediaStream} the stream to display */
    this.stream_ = null;
    /**
     * @private {?HTMLVideoElement} video element mirroring the camera stream.
     *    Set if visibility_ is true and stream_ is set.
     */
    this.video_ = null;
    /** @private {string} */
    this.debugPath_ = '<unknown>';
  }
  /**
   * Sets the path to this object from the debug global var.
   * @param {string} path
   */
  setDebugPath(path) {
    this.debugPath_ = path;
  }
  /**
   * Indicates if the video should be mirrored/displayed on the page.
   * @param {boolean} visible whether to add the video from the source stream to
   *     the page
   */
  setVisibility(visible) {
    this.visibility_ = visible;
    if (this.video_ && !this.visibility_) {
      this.video_.parentNode.removeChild(this.video_);
      this.video_ = null;
    }
    this.maybeAddVideoElement_();
  }

  /**
   * @param {!MediaStream} stream
   */
  setStream(stream) {
    this.stream_ = stream;
    this.maybeAddVideoElement_();
  }

  /** @private */
  maybeAddVideoElement_() {
    if (!this.video_ && this.visibility_ && this.stream_) {
      this.video_ =
        /** @type {!HTMLVideoElement} */ (document.createElement('video'));
      console.log(
          '[VideoMirrorHelper] Adding source video mirror.',
          `${this.debugPath_}.video_ =`, this.video_);
      this.video_.classList.add('video', 'sourceVideo');
      this.video_.srcObject = this.stream_;
      const outputVideo = document.getElementById('outputVideo');
      outputVideo.parentNode.insertBefore(this.video_, outputVideo);
      this.video_.play();
    }
  }

  /** Frees any resources used by this object. */
  destroy() {
    if (this.video_) {
      this.video_.pause();
      this.video_.srcObject = null;
      this.video_.parentNode.removeChild(this.video_);
    }
  }
}

/**
 * Opens the device's camera with getUserMedia.
 * @implements {MediaStreamSource}
 */
class CameraSource {
  constructor() {
    /**
     * @private @const {!VideoMirrorHelper} manages displaying the video stream
     *     in the page
     */
    this.videoMirrorHelper_ = new VideoMirrorHelper();
    /** @private {?MediaStream} camera stream, initialized in getMediaStream */
    this.stream_ = null;
    /** @private {string} */
    this.debugPath_ = '<unknown>';
  }
  /** @override */
  setDebugPath(path) {
    this.debugPath_ = path;
    this.videoMirrorHelper_.setDebugPath(`${path}.videoMirrorHelper_`);
  }
  /** @override */
  setVisibility(visible) {
    this.videoMirrorHelper_.setVisibility(visible);
  }
  /** @override */
  async getMediaStream() {
    if (this.stream_) return this.stream_;
    console.log('[CameraSource] Requesting camera.');
    this.stream_ =
        await navigator.mediaDevices.getUserMedia({audio: false, video: true});
    console.log(
        '[CameraSource] Received camera stream.',
        `${this.debugPath_}.stream_ =`, this.stream_);
    this.videoMirrorHelper_.setStream(this.stream_);
    return this.stream_;
  }
  /** @override */
  destroy() {
    console.log('[CameraSource] Stopping camera');
    this.videoMirrorHelper_.destroy();
    if (this.stream_) {
      this.stream_.getTracks().forEach(t => t.stop());
    }
  }
}

/**
 * Decodes and plays a video.
 * @implements {MediaStreamSource}
 */
class VideoSource {
  constructor() {
    /** @private {boolean} */
    this.visibility_ = false;
    /** @private {?HTMLVideoElement} video element providing the MediaStream */
    this.video_ = null;
    /**
     * @private {?Promise<!MediaStream>} a Promise that resolves to the
     *     MediaStream from captureStream. Set iff video_ is set.
     */
    this.stream_ = null;
    /** @private {string} */
    this.debugPath_ = '<unknown>';
  }
  /** @override */
  setDebugPath(path) {
    this.debugPath_ = path;
  }
  /** @override */
  setVisibility(visible) {
    this.visibility_ = visible;
    if (this.video_) {
      this.updateVideoVisibility();
    }
  }
  /** @private */
  updateVideoVisibility() {
    if (this.video_.parentNode && !this.visibility_) {
      if (!this.video_.paused) {
        // Video playback is automatically paused when the element is removed
        // from the DOM. That is not the behavior we want.
        this.video_.onpause = async () => {
          this.video_.onpause = null;
          await this.video_.play();
        };
      }
      this.video_.parentNode.removeChild(this.video_);
    } else if (!this.video_.parentNode && this.visibility_) {
      console.log(
          '[VideoSource] Adding source video element to page.',
          `${this.debugPath_}.video_ =`, this.video_);
      const outputVideo = document.getElementById('outputVideo');
      outputVideo.parentNode.insertBefore(this.video_, outputVideo);
    }
  }
  /** @override */
  async getMediaStream() {
    if (this.stream_) return this.stream_;

    console.log('[VideoSource] Loading video');

    this.video_ =
      /** @type {!HTMLVideoElement} */ (document.createElement('video'));
    this.video_.classList.add('video', 'sourceVideo');
    this.video_.controls = true;
    this.video_.loop = true;
    this.video_.muted = true;
    // TODO(benjaminwagner): this isn't the best way to do this
    this.video_.innerHTML = `
        <source src="../../../video/chrome.webm" type="video/webm"/>
        <source src="../../../video/chrome.mp4" type="video/mp4"/>
        <p>This browser does not support the video element.</p>`;
    this.video_.load();
    this.video_.play();
    this.updateVideoVisibility();
    this.stream_ = new Promise((resolve, reject) => {
      this.video_.oncanplay = () => {
        if (!resolve || !reject) return;
        console.log('[VideoSource] Obtaining video capture stream');
        if (this.video_.captureStream) {
          resolve(this.video_.captureStream());
        } else if (this.video_.mozCaptureStream) {
          resolve(this.video_.mozCaptureStream());
        } else {
          const e = new Error('Stream capture is not supported');
          console.error(e);
          reject(e);
        }
        resolve = null;
        reject = null;
      };
    });
    await this.stream_;
    console.log(
        '[VideoSource] Received source video stream.',
        `${this.debugPath_}.stream_ =`, this.stream_);
    return this.stream_;
  }
  /** @override */
  destroy() {
    if (this.video_) {
      console.log('[VideoSource] Stopping source video');
      this.video_.pause();
      if (this.video_.parentNode) {
        this.video_.parentNode.removeChild(this.video_);
      }
    }
  }
}

/**
 * Sends a MediaStream to one end of an RTCPeerConnection and provides the
 * remote end as the resulting MediaStream.
 * In an actual video calling app, the two RTCPeerConnection objects would be
 * instantiated on different devices. However, in this sample, both sides of the
 * peer connection are local to allow the sample to be self-contained.
 * For more detailed samples using RTCPeerConnection, take a look at
 * https://webrtc.github.io/samples/.
 */
class PeerConnectionPipe {
  /**
   * @param {!MediaStream} inputStream stream to pipe over the peer connection
   * @param {string} debugPath the path to this object from the debug global var
   */
  constructor(inputStream, debugPath) {
    /**
     * @private @const {!RTCPeerConnection} the calling side of the peer
     *     connection, connected to inputStream_.
     */
    this.caller_ = new RTCPeerConnection(null);
    /**
     * @private @const {!RTCPeerConnection} the answering side of the peer
     *     connection, providing the stream returned by getMediaStream.
     */
    this.callee_ = new RTCPeerConnection(null);
    /** @private {string} */
    this.debugPath_ = debugPath;
    /**
     * @private @const {!Promise<!MediaStream>} the stream containing tracks
     *     from callee_, returned by getMediaStream.
     */
    this.outputStreamPromise_ = this.init_(inputStream);
  }
  /**
   * Sets the path to this object from the debug global var.
   * @param {string} path
   */
  setDebugPath(path) {
    this.debugPath_ = path;
  }
  /**
   * @param {!MediaStream} inputStream stream to pipe over the peer connection
   * @return {!Promise<!MediaStream>}
   * @private
   */
  async init_(inputStream) {
    console.log(
        '[PeerConnectionPipe] Initiating peer connection.',
        `${this.debugPath_} =`, this);
    this.caller_.onicecandidate = (/** !RTCPeerConnectionIceEvent*/ event) => {
      if (event.candidate) this.callee_.addIceCandidate(event.candidate);
    };
    this.callee_.onicecandidate = (/** !RTCPeerConnectionIceEvent */ event) => {
      if (event.candidate) this.caller_.addIceCandidate(event.candidate);
    };
    const outputStream = new MediaStream();
    const receiverStreamPromise = new Promise(resolve => {
      this.callee_.ontrack = (/** !RTCTrackEvent */ event) => {
        if (!event.track) return;
        outputStream.addTrack(event.track);
        if (outputStream.getTracks().length == inputStream.getTracks().length) {
          resolve(outputStream);
        }
      };
    });
    inputStream.getTracks().forEach(track => {
      this.caller_.addTransceiver(track, {direction: 'sendonly'});
    });
    await this.caller_.setLocalDescription();
    await this.callee_.setRemoteDescription(
        /** @type {!RTCSessionDescription} */ (this.caller_.localDescription));
    await this.callee_.setLocalDescription();
    await this.caller_.setRemoteDescription(
        /** @type {!RTCSessionDescription} */ (this.callee_.localDescription));
    await receiverStreamPromise;
    console.log(
        '[PeerConnectionPipe] Peer connection established.',
        `${this.debugPath_}.caller_ =`, this.caller_,
        `${this.debugPath_}.callee_ =`, this.callee_);
    return receiverStreamPromise;
  }

  /**
   * Provides the MediaStream that has been piped through a peer connection.
   * @return {!Promise<!MediaStream>}
   */
  getOutputStream() {
    return this.outputStreamPromise_;
  }

  /** Frees any resources used by this object. */
  destroy() {
    console.log('[PeerConnectionPipe] Closing peer connection.');
    this.caller_.close();
    this.callee_.close();
  }
}

/**
 * Sends the original source video to one end of an RTCPeerConnection and
 * provides the remote end as the final source.
 * In this sample, a PeerConnectionSource represents receiving video from a
 * remote participant and locally processing it using a
 * MediaStreamTrackProcessor before displaying it on the screen. Contrast with a
 * PeerConnectionSink.
 * @implements {MediaStreamSource}
 */
class PeerConnectionSource {
  /**
   * @param {!MediaStreamSource} originalSource original stream source, whose
   *     output is sent over the peer connection
   */
  constructor(originalSource) {
    /**
     * @private @const {!VideoMirrorHelper} manages displaying the video stream
     *     in the page
     */
    this.videoMirrorHelper_ = new VideoMirrorHelper();
    /**
     * @private @const {!MediaStreamSource} original stream source, whose output
     *     is sent on the sender peer connection. In an actual video calling
     *     app, this stream would be generated from the remote participant's
     *     camera. However, in this sample, both sides of the peer connection
     *     are local to allow the sample to be self-contained.
     */
    this.originalStreamSource_ = originalSource;
    /**
     * @private {?PeerConnectionPipe} handles piping the MediaStream through an
     *     RTCPeerConnection
     */
    this.pipe_ = null;
    /** @private {string} */
    this.debugPath_ = '<unknown>';
  }
  /** @override */
  setDebugPath(path) {
    this.debugPath_ = path;
    this.videoMirrorHelper_.setDebugPath(`${path}.videoMirrorHelper_`);
    this.originalStreamSource_.setDebugPath(`${path}.originalStreamSource_`);
    if (this.pipe_) this.pipe_.setDebugPath(`${path}.pipe_`);
  }
  /** @override */
  setVisibility(visible) {
    this.videoMirrorHelper_.setVisibility(visible);
  }

  /** @override */
  async getMediaStream() {
    if (this.pipe_) return this.pipe_.getOutputStream();

    console.log(
        '[PeerConnectionSource] Obtaining original source media stream.',
        `${this.debugPath_}.originalStreamSource_ =`,
        this.originalStreamSource_);
    const originalStream = await this.originalStreamSource_.getMediaStream();
    this.pipe_ =
        new PeerConnectionPipe(originalStream, `${this.debugPath_}.pipe_`);
    const outputStream = await this.pipe_.getOutputStream();
    console.log(
        '[PeerConnectionSource] Received callee peer connection stream.',
        outputStream);
    this.videoMirrorHelper_.setStream(outputStream);
    return outputStream;
  }

  /** @override */
  destroy() {
    this.videoMirrorHelper_.destroy();
    if (this.pipe_) this.pipe_.destroy();
    this.originalStreamSource_.destroy();
  }
}

/**
 * Applies a warp effect using WebGL.
 * @implements {FrameTransform}
 */
class WebGLTransform {
  constructor() {
    // All fields are initialized in init()
    /** @private {?OffscreenCanvas} canvas used to create the WebGL context */
    this.canvas_ = null;
    /** @private {?WebGLRenderingContext} */
    this.gl_ = null;
    /** @private {?WebGLUniformLocation} location of inSampler */
    this.sampler_ = null;
    /** @private {?WebGLProgram} */
    this.program_ = null;
    /** @private {?WebGLTexture} input texture */
    this.texture_ = null;
    /** @private {string} */
    this.debugPath_ = 'debug.pipeline.frameTransform_';
  }
  /** @override */
  async init() {
    console.log('[WebGLTransform] Initializing WebGL.');
    this.canvas_ = new OffscreenCanvas(1, 1);
    const gl = /** @type {?WebGLRenderingContext} */ (
      this.canvas_.getContext('webgl'));
    if (!gl) {
      alert(
          'Failed to create WebGL context. Check that WebGL is supported ' +
          'by your browser and hardware.');
      return;
    }
    this.gl_ = gl;
    const vertexShader = this.loadShader_(gl.VERTEX_SHADER, `
      precision mediump float;
      attribute vec3 g_Position;
      attribute vec2 g_TexCoord;
      varying vec2 texCoord;
      void main() {
        gl_Position = vec4(g_Position, 1.0);
        texCoord = g_TexCoord;
      }`);
    const fragmentShader = this.loadShader_(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 texCoord;
      uniform sampler2D inSampler;
      void main(void) {
        float boundary = distance(texCoord, vec2(0.5)) - 0.2;
        if (boundary < 0.0) {
          gl_FragColor = texture2D(inSampler, texCoord);
        } else {
          // Rotate the position
          float angle = 2.0 * boundary;
          vec2 rotation = vec2(sin(angle), cos(angle));
          vec2 fromCenter = texCoord - vec2(0.5);
          vec2 rotatedPosition = vec2(
            fromCenter.x * rotation.y + fromCenter.y * rotation.x,
            fromCenter.y * rotation.y - fromCenter.x * rotation.x) + vec2(0.5);
          gl_FragColor = texture2D(inSampler, rotatedPosition);
        }
      }`);
    if (!vertexShader || !fragmentShader) return;
    // Create the program object
    const programObject = gl.createProgram();
    gl.attachShader(programObject, vertexShader);
    gl.attachShader(programObject, fragmentShader);
    // Link the program
    gl.linkProgram(programObject);
    // Check the link status
    const linked = gl.getProgramParameter(programObject, gl.LINK_STATUS);
    if (!linked) {
      const infoLog = gl.getProgramInfoLog(programObject);
      gl.deleteProgram(programObject);
      throw new Error(`Error linking program:\n${infoLog}`);
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    this.sampler_ = gl.getUniformLocation(programObject, 'inSampler');
    this.program_ = programObject;
    // Bind attributes
    const vertices = [1.0, -1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0];
    // Pass-through.
    const txtcoords = [1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    // Mirror horizonally.
    // const txtcoords = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
    this.attributeSetFloats_('g_Position', 2, vertices);
    this.attributeSetFloats_('g_TexCoord', 2, txtcoords);
    // Initialize input texture
    this.texture_ = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture_);
    const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    console.log(
        '[WebGLTransform] WebGL initialized.', `${this.debugPath_}.canvas_ =`,
        this.canvas_, `${this.debugPath_}.gl_ =`, this.gl_);
  }

  /**
   * Creates and compiles a WebGLShader from the provided source code.
   * @param {number} type either VERTEX_SHADER or FRAGMENT_SHADER
   * @param {string} shaderSrc
   * @return {!WebGLShader}
   * @private
   */
  loadShader_(type, shaderSrc) {
    const gl = this.gl_;
    const shader = gl.createShader(type);
    // Load the shader source
    gl.shaderSource(shader, shaderSrc);
    // Compile the shader
    gl.compileShader(shader);
    // Check the compile status
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const infoLog = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Error compiling shader:\n${infoLog}`);
    }
    return shader;
  }

  /**
   * Sets a floating point shader attribute to the values in arr.
   * @param {string} attrName the name of the shader attribute to set
   * @param {number} vsize the number of components of the shader attribute's
   *   type
   * @param {!Array<number>} arr the values to set
   * @private
   */
  attributeSetFloats_(attrName, vsize, arr) {
    const gl = this.gl_;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(this.program_, attrName);
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, vsize, gl.FLOAT, false, 0, 0);
  }

  /** @override */
  async transform(frame, controller) {
    const gl = this.gl_;
    if (!gl || !this.canvas_) {
      frame.destroy();
      return;
    }
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    if (this.canvas_.width !== width || this.canvas_.height !== height) {
      this.canvas_.width = width;
      this.canvas_.height = height;
      gl.viewport(0, 0, width, height);
    }
    // VideoFrame.timestamp is technically optional, but that should never
    // happen here.
    // TODO(benjaminwagner): Follow up if we should change the spec so this is
    // non-optional.
    const timestamp = /** @type {number} */ (frame.timestamp);
    const inputBitmap = await frame.createImageBitmap();
    frame.destroy();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture_);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inputBitmap);
    gl.useProgram(this.program_);
    gl.uniform1i(this.sampler_, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const outputBitmap = await createImageBitmap(this.canvas_);
    const outputFrame = new VideoFrame(outputBitmap, {timestamp});
    controller.enqueue(outputFrame);
  }

  /** @override */
  destroy() {
    if (this.gl_) {
      console.log('[WebGLTransform] Forcing WebGL context to be lost.');
      /** @type {!WEBGL_lose_context} */ (
        this.gl_.getExtension('WEBGL_lose_context'))
          .loseContext();
    }
  }
}

/**
 * Applies a picture-frame effect using CanvasRenderingContext2D.
 * @implements {FrameTransform}
 */
class CanvasTransform {
  constructor() {
    // All fields are initialized in init()
    /** @private {?OffscreenCanvas} canvas used to create the 2D context */
    this.canvas_ = null;
    /**
     * @private {?CanvasRenderingContext2D} the 2D context used to draw the
     *     effect
     */
    this.ctx_ = null;
    /** @private {string} */
    this.debugPath_ = 'debug.pipeline.frameTransform_';
  }
  /** @override */
  async init() {
    console.log('[CanvasTransform] Initializing 2D context for transform');
    this.canvas_ = new OffscreenCanvas(1, 1);
    this.ctx_ = /** @type {?CanvasRenderingContext2D} */ (
      this.canvas_.getContext('2d', {alpha: false, desynchronized: true}));
    if (!this.ctx_) {
      throw new Error('Unable to create CanvasRenderingContext2D');
    }
    console.log(
        '[CanvasTransform] CanvasRenderingContext2D initialized.',
        `${this.debugPath_}.canvas_ =`, this.canvas_,
        `${this.debugPath_}.ctx_ =`, this.ctx_);
  }

  /** @override */
  async transform(frame, controller) {
    const ctx = this.ctx_;
    if (!this.canvas_ || !ctx) {
      frame.destroy();
      return;
    }
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    this.canvas_.width = width;
    this.canvas_.height = height;
    // VideoFrame.timestamp is technically optional, but that should never
    // happen here.
    // TODO(benjaminwagner): Follow up if we should change the spec so this is
    // non-optional.
    const timestamp = /** @type {number} */ (frame.timestamp);
    const inputBitmap = await frame.createImageBitmap();
    frame.destroy();

    ctx.drawImage(inputBitmap, 0, 0);
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 50;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(0, 0, width, height);

    const outputBitmap = await createImageBitmap(this.canvas_);
    const outputFrame = new VideoFrame(outputBitmap, {timestamp});
    controller.enqueue(outputFrame);
  }

  /** @override */
  destroy() {}
}

/**
 * Drops frames at random.
 * @implements {FrameTransform}
 */
class DropTransform {
  /** @override */
  async init() {}
  /** @override */
  async transform(frame, controller) {
    if (Math.random() < 0.5) {
      controller.enqueue(frame);
    } else {
      frame.destroy();
    }
  }
  /** @override */
  destroy() {}
}

/**
 * Delays all frames by 100ms.
 * TODO(benjaminwagner): Should the timestamp be adjusted?
 * @implements {FrameTransform}
 */
class DelayTransform {
  /** @override */
  async init() {}
  /** @override */
  async transform(frame, controller) {
    // TODO(benjaminwagner): why is there a difference between await vs.
    // callback?
    await new Promise(resolve => setTimeout(resolve, 100));
    controller.enqueue(frame);
  }
  /** @override */
  destroy() {}
}

/**
 * Displays the output stream in a video element.
 * @implements {MediaStreamSink}
 */
class VideoSink {
  constructor() {
    /**
     * @private {?HTMLVideoElement} output video element
     */
    this.video_ = null;
    /** @private {string} */
    this.debugPath_ = 'debug.pipeline.sink_';
  }
  /**
   * Sets the path to this object from the debug global var.
   * @param {string} path
   */
  setDebugPath(path) {
    this.debugPath_ = path;
  }
  /** @override */
  async setMediaStream(stream) {
    console.log('[VideoSink] Setting sink stream.', stream);
    if (!this.video_) {
      this.video_ =
        /** @type {!HTMLVideoElement} */ (document.createElement('video'));
      this.video_.classList.add('video', 'sinkVideo');
      document.getElementById('outputVideo').appendChild(this.video_);
      console.log(
          '[VideoSink] Added video element to page.',
          `${this.debugPath_}.video_ =`, this.video_);
    }
    this.video_.srcObject = stream;
    this.video_.play();
  }
  /** @override */
  destroy() {
    if (this.video_) {
      console.log('[VideoSink] Stopping sink video');
      this.video_.pause();
      this.video_.srcObject = null;
      this.video_.parentNode.removeChild(this.video_);
    }
  }
}

/**
 * Sends the transformed video to one end of an RTCPeerConnection and displays
 * the remote end in a video element. In this sample, a PeerConnectionSink
 * represents processing the local user's camera input using a
 * MediaStreamTrackProcessor before sending it to a remote video call
 * participant. Contrast with a PeerConnectionSource.
 * @implements {MediaStreamSink}
 */
class PeerConnectionSink {
  constructor() {
    /**
     * @private @const {!VideoSink} manages displaying the video stream in the
     *     page
     */
    this.videoSink_ = new VideoSink();
    /**
     * @private {?PeerConnectionPipe} handles piping the MediaStream through an
     *     RTCPeerConnection
     */
    this.pipe_ = null;
    /** @private {string} */
    this.debugPath_ = 'debug.pipeline.sink_';
    this.videoSink_.setDebugPath(`${this.debugPath_}.videoSink_`);
  }

  /** @override */
  async setMediaStream(stream) {
    console.log(
        '[PeerConnectionSink] Setting peer connection sink stream.', stream);
    if (this.pipe_) this.pipe_.destroy();
    this.pipe_ = new PeerConnectionPipe(stream, `${this.debugPath_}.pipe_`);
    const pipedStream = await this.pipe_.getOutputStream();
    console.log(
        '[PeerConnectionSink] Received callee peer connection stream.',
        pipedStream);
    await this.videoSink_.setMediaStream(pipedStream);
  }

  /** @override */
  destroy() {
    this.videoSink_.destroy();
    if (this.pipe_) this.pipe_.destroy();
  }
}

initPipeline();
