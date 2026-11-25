/// Wendet `transform` parallel auf alle Elemente an, mit höchstens `maxConcurrency`
/// gleichzeitigen Aufgaben (einfache Backpressure). `nil`-Ergebnisse werden verworfen.
/// Die Reihenfolge der Ergebnisse ist nicht garantiert.
///
/// Hinweis: `transform` macht blockierendes Datei-I/O im kooperativen Thread-Pool.
/// Durch die Begrenzung auf die Kernzahl bleibt das im Spike vertretbar; ab Schritt 6
/// wandert das I/O in einen eigenen Thread-Pool bzw. XPC-Service (ARCHITECTURE.md).
public func concurrentCompactMap<T: Sendable, R: Sendable>(
    _ items: [T],
    maxConcurrency: Int,
    _ transform: @escaping @Sendable (T) -> R?
) async throws -> [R] {
    precondition(maxConcurrency > 0, "maxConcurrency muss größer als 0 sein")
    return try await withThrowingTaskGroup(of: R?.self, returning: [R].self) { group in
        var results: [R] = []
        results.reserveCapacity(items.count)
        var iterator = items.makeIterator()

        for _ in 0..<min(maxConcurrency, items.count) {
            guard let item = iterator.next() else { break }
            group.addTask {
                try Task.checkCancellation()
                return transform(item)
            }
        }
        while let result = try await group.next() {
            if let value = result { results.append(value) }
            if let item = iterator.next() {
                group.addTask {
                    try Task.checkCancellation()
                    return transform(item)
                }
            }
        }
        return results
    }
}
