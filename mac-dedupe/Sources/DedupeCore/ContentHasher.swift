import CryptoKit
import Darwin
import Foundation

/// Fingerabdruck eines Dateiinhalts (SHA-256, siehe ADR 0003).
public struct ContentDigest: Sendable, Hashable, CustomStringConvertible {
    public let bytes: Data

    init(_ digest: SHA256Digest) { bytes = Data(digest) }

    public var description: String {
        bytes.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}

public enum HashError: Error, Sendable {
    case cannotOpen(path: String, errno: Int32)
    case readFailed(path: String, errno: Int32)
}

public enum ContentHasher {
    /// Größe von Anfangs- und Endstück für den Teil-Hash.
    public static let partialChunkSize = 64 * 1024
    /// Lesepuffer für den Voll-Hash. 1 MiB liegt auf Apple-SSDs im Sättigungsbereich.
    public static let readBufferSize = 1 << 20

    /// Ist die Datei so klein, dass der Teil-Hash bereits den ganzen Inhalt abdeckt?
    public static func partialCoversWholeFile(size: Int64) -> Bool {
        size <= Int64(2 * partialChunkSize)
    }

    /// Hash über Dateigröße, die ersten und die letzten 64 KiB.
    /// Bei kleinen Dateien über den gesamten Inhalt.
    public static func partialDigest(path: String, size: Int64) throws -> ContentDigest {
        let fd = try openForReading(path, noCache: false)
        defer { close(fd) }
        var hasher = SHA256()
        withUnsafeBytes(of: size.littleEndian) { hasher.update(bufferPointer: $0) }
        if partialCoversWholeFile(size: size) {
            _ = try readAll(fd, path: path, into: &hasher)
        } else {
            try readRange(fd, path: path, offset: 0, count: partialChunkSize, into: &hasher)
            try readRange(fd, path: path, offset: size - Int64(partialChunkSize), count: partialChunkSize, into: &hasher)
        }
        return ContentDigest(hasher.finalize())
    }

    /// Hash über den gesamten Inhalt. Gibt zusätzlich die gelesenen Bytes für die Statistik zurück.
    public static func fullDigest(path: String) throws -> (digest: ContentDigest, bytesRead: Int64) {
        // F_NOCACHE: Einmal-Lesen soll den Page-Cache nicht mit Gigabytes fluten.
        let fd = try openForReading(path, noCache: true)
        defer { close(fd) }
        var hasher = SHA256()
        let bytes = try readAll(fd, path: path, into: &hasher)
        return (ContentDigest(hasher.finalize()), bytes)
    }

    // MARK: - POSIX-I/O

    private static func openForReading(_ path: String, noCache: Bool) throws -> Int32 {
        let fd = open(path, O_RDONLY)
        guard fd >= 0 else { throw HashError.cannotOpen(path: path, errno: errno) }
        if noCache { _ = fcntl(fd, F_NOCACHE, 1) }
        return fd
    }

    private static func readRange(_ fd: Int32, path: String, offset: Int64, count: Int, into hasher: inout SHA256) throws {
        let buffer = UnsafeMutableRawBufferPointer.allocate(byteCount: count, alignment: 16)
        defer { buffer.deallocate() }
        var done = 0
        while done < count {
            let n = pread(fd, buffer.baseAddress! + done, count - done, off_t(offset) + off_t(done))
            if n < 0 {
                if errno == EINTR { continue }
                throw HashError.readFailed(path: path, errno: errno)
            }
            if n == 0 { break }
            done += n
        }
        hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: buffer[0..<done]))
    }

    private static func readAll(_ fd: Int32, path: String, into hasher: inout SHA256) throws -> Int64 {
        // An Seitengrenzen ausgerichtet, damit F_NOCACHE-Lesevorgänge ohne Umkopieren laufen.
        let buffer = UnsafeMutableRawBufferPointer.allocate(byteCount: readBufferSize, alignment: Int(getpagesize()))
        defer { buffer.deallocate() }
        var total: Int64 = 0
        while true {
            let n = read(fd, buffer.baseAddress!, readBufferSize)
            if n < 0 {
                if errno == EINTR { continue }
                throw HashError.readFailed(path: path, errno: errno)
            }
            if n == 0 { break }
            hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: buffer[0..<n]))
            total += Int64(n)
        }
        return total
    }
}
