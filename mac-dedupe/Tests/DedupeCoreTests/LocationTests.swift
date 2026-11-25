import Testing
@testable import DedupeCore

private let home = "/Users/anna"
private let internalDisk = VolumeInfo(name: "Macintosh HD", isInternal: true, isLocal: true)
private let externalDisk = VolumeInfo(name: "Backup", isInternal: false, isLocal: true)
private let nas = VolumeInfo(name: "NAS", isInternal: false, isLocal: false)

@Suite("Speicherort-Ampel")
struct LocationClassifierTests {
    let classifier = LocationClassifier(
        homeDirectory: home,
        masterFolders: [.photo: "/Users/anna/Pictures/Archiv"]
    )

    @Test func masterFolderIsGreen() {
        let v = classifier.classify(path: "/Users/anna/Pictures/Archiv/2024/IMG_1.jpg", category: .photo, volume: internalDisk)
        #expect(v.light == .green)
        #expect(v.isInMasterFolder)
        #expect(v.reason == "Liegt im Master-Ordner für Fotos")
    }

    @Test func copyOutsideMasterIsYellow() {
        let v = classifier.classify(path: "/Users/anna/Documents/IMG_1.jpg", category: .photo, volume: internalDisk)
        #expect(v.light == .yellow)
        #expect(!v.isInMasterFolder)
    }

    @Test func folderWithSimilarNameIsNotMaster() {
        // „Archiv2" darf nicht als „Archiv" erkannt werden.
        let v = classifier.classify(path: "/Users/anna/Pictures/Archiv2/IMG_1.jpg", category: .photo, volume: internalDisk)
        #expect(!v.isInMasterFolder)
    }

    @Test func downloadsIsYellow() {
        let v = classifier.classify(path: "/Users/anna/Downloads/rechnung.pdf", category: .document, volume: internalDisk)
        #expect(v.light == .yellow)
        #expect(v.reason.contains("Downloads"))
    }

    @Test func noMasterMeansGreen() {
        let v = classifier.classify(path: "/Users/anna/Documents/rechnung.pdf", category: .document, volume: internalDisk)
        #expect(v.light == .green)
    }

    @Test(arguments: [
        "/System/Library/Fonts/Helvetica.ttc",
        "/Applications/Safari.app/Contents/Resources/x.png",
        "/Users/anna/Library/Application Support/App/data.db",
        "/Users/anna/Projekte/Tool.app/Contents/Info.plist",
    ])
    func protectedPathsAreRed(path: String) {
        let v = classifier.classify(path: path, category: .other, volume: internalDisk)
        #expect(v.light == .red)
        #expect(v.isLocked)
    }

    @Test func photosLibraryIsRedAndKindPhotos() {
        let v = classifier.classify(
            path: "/Users/anna/Pictures/Photos Library.photoslibrary/originals/A/IMG.heic",
            category: .photo, volume: internalDisk
        )
        #expect(v.kind == .photosLibrary)
        #expect(v.light == .red)
    }

    @Test func iCloudDriveIsNotTreatedAsLibrary() {
        let v = classifier.classify(
            path: "/Users/anna/Library/Mobile Documents/com~apple~CloudDocs/Scan.pdf",
            category: .document, volume: internalDisk
        )
        #expect(v.kind == .iCloudDrive)
        #expect(v.light == .green)
    }

    @Test func cloudStorageProviderIsDetected() {
        let v = classifier.classify(
            path: "/Users/anna/Library/CloudStorage/OneDrive-Persönlich/Bild.jpg",
            category: .photo, volume: internalDisk
        )
        #expect(v.kind == .cloudFolder(provider: "OneDrive"))
        #expect(!v.isLocked)
    }

    @Test func trashIsYellow() {
        let v = classifier.classify(path: "/Users/anna/.Trash/alt.jpg", category: .photo, volume: internalDisk)
        #expect(v.kind == .trash)
        #expect(v.light == .yellow)
    }

    @Test func externalAndNetworkVolumes() {
        #expect(classifier.kind(path: "/Volumes/Backup/Fotos/a.jpg", volume: externalDisk) == .externalDisk)
        #expect(classifier.kind(path: "/Volumes/NAS/Fotos/a.jpg", volume: nas) == .network)
    }
}

@Suite("Breadcrumb")
struct BreadcrumbTests {
    @Test func shortensMiddle() {
        let crumb = Breadcrumb(path: "/Users/anna/Pictures/Reisen/Urlaub 2024/IMG_0421.jpg", volume: internalDisk)
        #expect(crumb.display() == "Macintosh HD › Users › … › Urlaub 2024 › IMG_0421.jpg")
        #expect(crumb.fileName == "IMG_0421.jpg")
        #expect(crumb.fullDisplay == "Macintosh HD › Users › anna › Pictures › Reisen › Urlaub 2024 › IMG_0421.jpg")
    }

    @Test func shortPathStaysComplete() {
        let crumb = Breadcrumb(path: "/Users/a.jpg", volume: internalDisk)
        #expect(crumb.display() == "Macintosh HD › Users › a.jpg")
    }

    @Test func externalVolumeUsesMountName() {
        let crumb = Breadcrumb(path: "/Volumes/Backup/Fotos/a.jpg", volume: externalDisk)
        #expect(crumb.components == ["Backup", "Fotos", "a.jpg"])
    }
}
