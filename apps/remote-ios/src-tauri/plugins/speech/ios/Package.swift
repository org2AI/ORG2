// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-speech",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "tauri-plugin-speech",
            type: .static,
            targets: ["tauri-plugin-speech"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-speech",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources"
        )
    ]
)
