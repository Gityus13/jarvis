import AVFoundation
import Foundation
import Speech

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

let speech = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
guard let speech = speech else {
    emit(["error": "Speech recognizer unavailable"])
    exit(2)
}

let speechStatus = SFSpeechRecognizer.authorizationStatus()
if speechStatus != .authorized {
    SFSpeechRecognizer.requestAuthorization { status in
        if status != .authorized {
            emit(["error": "Speech recognition permission denied"])
            exit(3)
        }
    }
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 1))
}
if SFSpeechRecognizer.authorizationStatus() != .authorized {
    emit(["error": "Speech recognition permission denied"])
    exit(3)
}

let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
if micStatus != .authorized {
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        if !granted {
            emit(["error": "Microphone permission denied"])
            exit(4)
        }
    }
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 1))
}
if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
    emit(["error": "Microphone permission denied"])
    exit(4)
}

guard speech.supportsOnDeviceRecognition else {
    emit(["error": "On-device speech recognition is unavailable on this macOS"])
    exit(5)
}

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.requiresOnDeviceRecognition = true
request.addsPunctuation = true

let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    request.append(buffer)
}

var finalText = ""
let task = speech.recognitionTask(with: request) { result, error in
    if let result = result {
        let text = result.bestTranscription.formattedString
        finalText = text
        emit(["text": text, "final": result.isFinal])
    }
    if let error = error {
        emit(["error": error.localizedDescription])
    }
}

do {
    try engine.start()
} catch {
    emit(["error": "Could not start microphone: \(error.localizedDescription)"])
    exit(6)
}

emit(["text": "", "final": false])
DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
    request.endAudio()
    engine.stop()
    input.removeTap(onBus: 0)
    emit(["text": finalText, "final": true])
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        task.cancel()
        exit(0)
    }
}

RunLoop.main.run()
