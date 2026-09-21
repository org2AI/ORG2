import AVFoundation
import Speech
import SwiftRs
import Tauri
import UIKit

private struct StartArgs: Decodable {
    let lang: String?
    let sessionId: String
}

private struct SessionArgs: Decodable {
    let sessionId: String
}

private struct SupportResponse: Encodable {
    let supported: Bool
}

private struct SpeechEvent: Encodable {
    let sessionId: String
    let kind: String
    let transcript: String?
    let code: String?
    let message: String?
}

final class SpeechPlugin: Plugin {
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var activeSessionId: String?
    private var pendingSessionId: String?
    private var latestTranscript = ""
    private var finishing = false
    private var tapInstalled = false
    private var deadline: DispatchWorkItem?
    private var backgroundObserver: NSObjectProtocol?

    override init() {
        super.init()
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pendingSessionId = nil
            self?.finishSession(kind: "cancelled", cancelTask: true)
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
        deadline?.cancel()
        cleanupResources(cancelTask: true)
    }

    @objc func isSupported(_ invoke: Invoke) {
        invoke.resolve(SupportResponse(supported: SFSpeechRecognizer() != nil))
    }

    @objc func start(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StartArgs.self)
        DispatchQueue.main.async { [weak self] in
            self?.requestPermissionsAndStart(args: args, invoke: invoke)
        }
    }

    @objc func stop(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SessionArgs.self)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.activeSessionId == args.sessionId else {
                invoke.resolve()
                return
            }
            self.finishing = true
            self.stopAudioCapture()
            self.recognitionRequest?.endAudio()
            invoke.resolve()
        }
    }

    @objc func cancel(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SessionArgs.self)
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                invoke.resolve()
                return
            }
            if self.pendingSessionId == args.sessionId {
                self.pendingSessionId = nil
                invoke.resolve()
                return
            }
            guard self.activeSessionId == args.sessionId else {
                invoke.resolve()
                return
            }
            self.finishSession(kind: "cancelled", cancelTask: true)
            invoke.resolve()
        }
    }

    private func requestPermissionsAndStart(args: StartArgs, invoke: Invoke) {
        guard activeSessionId == nil, pendingSessionId == nil else {
            invoke.reject("Speech recognition is already active", code: "busy")
            return
        }
        pendingSessionId = args.sessionId

        requestSpeechPermission { [weak self] speechGranted in
            guard let self else { return }
            guard self.pendingSessionId == args.sessionId else {
                invoke.reject("Speech recognition was cancelled", code: "cancelled")
                return
            }
            guard speechGranted else {
                self.pendingSessionId = nil
                invoke.reject("Speech recognition permission denied", code: "permission-denied")
                return
            }
            self.requestMicrophonePermission { [weak self] microphoneGranted in
                guard let self else { return }
                guard self.pendingSessionId == args.sessionId else {
                    invoke.reject("Speech recognition was cancelled", code: "cancelled")
                    return
                }
                guard microphoneGranted else {
                    self.pendingSessionId = nil
                    invoke.reject("Microphone permission denied", code: "permission-denied")
                    return
                }
                self.pendingSessionId = nil
                self.beginRecognition(args: args, invoke: invoke)
            }
        }
    }

    private func requestSpeechPermission(completion: @escaping (Bool) -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            completion(true)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async { completion(status == .authorized) }
            }
        case .denied, .restricted:
            completion(false)
        @unknown default:
            completion(false)
        }
    }

    private func requestMicrophonePermission(completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                completion(true)
            case .undetermined:
                AVAudioApplication.requestRecordPermission { granted in
                    DispatchQueue.main.async { completion(granted) }
                }
            case .denied:
                completion(false)
            @unknown default:
                completion(false)
            }
            return
        }

        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            completion(true)
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        case .denied:
            completion(false)
        @unknown default:
            completion(false)
        }
    }

    private func beginRecognition(args: StartArgs, invoke: Invoke) {
        let locale = args.lang.map(Locale.init(identifier:)) ?? Locale.current
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            invoke.reject("Speech recognition is unavailable", code: "unsupported")
            return
        }

        cleanupResources(cancelTask: true)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request
        activeSessionId = args.sessionId
        latestTranscript = ""
        finishing = false

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        guard recordingFormat.sampleRate > 0, recordingFormat.channelCount > 0 else {
            finishSession(
                kind: "error",
                code: "audio-capture",
                message: "No microphone input is available",
                cancelTask: true
            )
            invoke.reject("No microphone input is available", code: "audio-capture")
            return
        }

        inputNode.installTap(
            onBus: 0,
            bufferSize: 1_024,
            format: recordingFormat
        ) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        tapInstalled = true

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            finishSession(
                kind: "error",
                code: "audio-capture",
                message: error.localizedDescription,
                cancelTask: true
            )
            invoke.reject(error.localizedDescription, code: "audio-capture")
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                self?.handleRecognitionResult(
                    result: result,
                    error: error,
                    sessionId: args.sessionId
                )
            }
        }
        let deadline = DispatchWorkItem { [weak self] in
            guard let self, self.activeSessionId == args.sessionId else { return }
            self.finishing = true
            self.stopAudioCapture()
            self.recognitionRequest?.endAudio()
        }
        self.deadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 55, execute: deadline)
        emit(kind: "started", sessionId: args.sessionId)
        invoke.resolve()
    }

    private func handleRecognitionResult(
        result: SFSpeechRecognitionResult?,
        error: Error?,
        sessionId: String
    ) {
        guard activeSessionId == sessionId else { return }

        if let result {
            latestTranscript = result.bestTranscription.formattedString
            emit(
                kind: result.isFinal ? "final" : "partial",
                sessionId: sessionId,
                transcript: latestTranscript
            )
            if result.isFinal {
                finishSession(kind: "ended", transcript: latestTranscript, cancelTask: false)
                return
            }
        }

        if let error {
            if finishing, !latestTranscript.isEmpty {
                finishSession(kind: "ended", transcript: latestTranscript, cancelTask: false)
            } else {
                let nsError = error as NSError
                let code = nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1101
                    ? "network"
                    : (latestTranscript.isEmpty ? "no-speech" : "unknown")
                finishSession(
                    kind: "error",
                    transcript: latestTranscript.isEmpty ? nil : latestTranscript,
                    code: code,
                    message: error.localizedDescription,
                    cancelTask: false
                )
            }
        }
    }

    private func stopAudioCapture() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
    }

    private func cleanupResources(cancelTask: Bool) {
        deadline?.cancel()
        deadline = nil
        stopAudioCapture()
        if cancelTask {
            recognitionTask?.cancel()
        }
        recognitionTask = nil
        recognitionRequest = nil
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    private func finishSession(
        kind: String,
        transcript: String? = nil,
        code: String? = nil,
        message: String? = nil,
        cancelTask: Bool
    ) {
        guard let sessionId = activeSessionId else { return }
        activeSessionId = nil
        finishing = false
        cleanupResources(cancelTask: cancelTask)
        emit(
            kind: kind,
            sessionId: sessionId,
            transcript: transcript,
            code: code,
            message: message
        )
        latestTranscript = ""
    }

    private func emit(
        kind: String,
        sessionId: String,
        transcript: String? = nil,
        code: String? = nil,
        message: String? = nil
    ) {
        try? trigger(
            "speech",
            data: SpeechEvent(
                sessionId: sessionId,
                kind: kind,
                transcript: transcript,
                code: code,
                message: message
            )
        )
    }
}

@_cdecl("init_plugin_speech")
func initPlugin() -> Plugin {
    SpeechPlugin()
}
