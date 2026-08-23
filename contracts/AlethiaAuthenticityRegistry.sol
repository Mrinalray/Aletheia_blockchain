// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * ALETHEIA — Decentralized Media Authenticity Registry
 * ------------------------------------------------------------------
 * SIH26204 (AICTE — Student Innovation)
 *
 * This contract does NOT detect deepfakes. ALETHEIA's existing AI /
 * forensic pipeline (SightEngine + Gemini) determines the verdict
 * off-chain. This contract only creates a tamper-evident,
 * independently verifiable record of an already-analysed media file:
 *
 *   - SHA-256 fingerprint of the media bytes
 *   - The verdict + confidence ALETHEIA already produced
 *   - Timestamp, media type, model version
 *   - An optional hash of the full forensic report (report stays off-chain)
 *
 * No image/video/audio content is ever stored on-chain — only hashes
 * and small metadata fields, per the "database vs blockchain" split
 * used by the ALETHEIA backend.
 * ------------------------------------------------------------------
 */
contract AlethiaAuthenticityRegistry {
    struct MediaRecord {
        bytes32 mediaHash;        // SHA-256 of the analysed media bytes
        string verificationId;    // human-friendly id, e.g. "ALT-9F3C21"
        string verdict;           // "real" | "ai" | "uncertain"
        uint8 confidence;         // 0-100
        string mediaType;         // "IMAGE" | "VIDEO" | "AUDIO" | "URL"
        string modelVersion;      // e.g. "sightengine-genai+gemini-2.5-flash"
        bytes32 reportHash;       // optional hash of the full forensic report (0x0 if unused)
        uint256 timestamp;        // block timestamp at registration
        address registeredBy;     // wallet that submitted the registration
        bool exists;
    }

    address public owner;

    mapping(bytes32 => MediaRecord) private recordsByHash;
    mapping(string => bytes32) private hashByVerificationId;

    uint256 public totalRegistrations;

    event MediaRegistered(
        bytes32 indexed mediaHash,
        string verificationId,
        string verdict,
        uint8 confidence,
        string mediaType,
        uint256 timestamp,
        address indexed registeredBy
    );

    constructor() {
        owner = msg.sender;
    }

    /**
     * Register a new authenticity record for a piece of media that
     * ALETHEIA has already analysed. Reverts if this exact media hash
     * (or verification id) has already been registered — this is the
     * "prevent unnecessary duplicate registrations" requirement.
     */
    function registerMedia(
        bytes32 mediaHash,
        string calldata verificationId,
        string calldata verdict,
        uint8 confidence,
        string calldata mediaType,
        string calldata modelVersion,
        bytes32 reportHash
    ) external {
        require(mediaHash != bytes32(0), "AlethiaRegistry: empty media hash");
        require(bytes(verificationId).length > 0, "AlethiaRegistry: empty verification id");
        require(!recordsByHash[mediaHash].exists, "AlethiaRegistry: media already registered");
        require(hashByVerificationId[verificationId] == bytes32(0), "AlethiaRegistry: verification id already in use");
        require(confidence <= 100, "AlethiaRegistry: confidence must be 0-100");

        recordsByHash[mediaHash] = MediaRecord({
            mediaHash: mediaHash,
            verificationId: verificationId,
            verdict: verdict,
            confidence: confidence,
            mediaType: mediaType,
            modelVersion: modelVersion,
            reportHash: reportHash,
            timestamp: block.timestamp,
            registeredBy: msg.sender,
            exists: true
        });

        hashByVerificationId[verificationId] = mediaHash;
        totalRegistrations += 1;

        emit MediaRegistered(
            mediaHash,
            verificationId,
            verdict,
            confidence,
            mediaType,
            block.timestamp,
            msg.sender
        );
    }

    /// Returns true only if an exact fingerprint match exists on-chain.
    /// A `false` result means "no matching record" — it does NOT mean fake.
    function verifyMedia(bytes32 mediaHash) external view returns (bool registered) {
        return recordsByHash[mediaHash].exists;
    }

    function getMediaRecord(bytes32 mediaHash) external view returns (MediaRecord memory) {
        require(recordsByHash[mediaHash].exists, "AlethiaRegistry: no record for this hash");
        return recordsByHash[mediaHash];
    }

    function getRecordByVerificationId(string calldata verificationId) external view returns (MediaRecord memory) {
        bytes32 h = hashByVerificationId[verificationId];
        require(h != bytes32(0), "AlethiaRegistry: unknown verification id");
        return recordsByHash[h];
    }
}
