import {
    Presentation,
    File,
    Camera,
    Mouse,
    Bot,
    MicOff,
    Pencil,
    Eraser,
    Trash2,
    GraduationCap,
    Mic,
    Hand,
    BookOpen,
    PenTool,
} from "lucide-react";

import {
    useEffect,
    useRef,
    useState,
    useCallback
} from "react";
import {
    useNavigate,
    useParams
} from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import api, { WS_URL } from "../api/api";

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/*
 * Finger extension is measured relative to the wrist/MCP distance.
 *
 * We intentionally stay in 2D. MediaPipe's z coordinate is an estimated
 * depth value and is considerably noisier for this particular comparison.
 */
function fingerExtensionRatio(
    landmarks,
    tipIndex,
    mcpIndex,
    wristIndex = 0
) {
    const wrist = landmarks[wristIndex];

    if (!wrist || !landmarks[tipIndex] || !landmarks[mcpIndex]) {
        return 0;
    }

    const mcpDist = distance(landmarks[mcpIndex], wrist);

    if (mcpDist < 1e-6) {
        return 0;
    }

    return distance(landmarks[tipIndex], wrist) / mcpDist;
}

/*
 * Palm center using wrist + four MCP landmarks.
 */
function palmCenter(landmarks) {
    const points = [
        landmarks[0],
        landmarks[5],
        landmarks[9],
        landmarks[13],
        landmarks[17]
    ];

    let x = 0;
    let y = 0;

    for (const point of points) {
        x += point.x;
        y += point.y;
    }

    return {
        x: x / points.length,
        y: y / points.length
    };
}

/*
 * Hand-scale reference.
 */
function handScale(landmarks) {
    return distance(landmarks[0], landmarks[9]) || 1e-6;
}

/*
 * Closed-fist score.
 *
 * Lower = more closed.
 * Higher = more open.
 */
function fistScore(landmarks) {
    const center = palmCenter(landmarks);
    const scale = handScale(landmarks);

    const fingertips = [8, 12, 16, 20];

    let total = 0;

    for (const tipIndex of fingertips) {
        total += distance(landmarks[tipIndex], center) / scale;
    }

    return total / fingertips.length;
}


/* ============================================================
 * Gesture thresholds
 * ============================================================
 *
 * Hysteresis prevents rapid flickering around the boundary.
 */

const INDEX_EXTEND_HIGH = 1.35;
const INDEX_EXTEND_LOW = 1.15;

const MIDDLE_EXTEND_HIGH = 1.55;
const MIDDLE_EXTEND_LOW = 1.30;

/*
 * A middle finger above this value means that the user is moving
 * toward the STOP gesture.
 *
 * This does NOT itself create STOP.
 * It only prevents DRAW from adding a final segment while the
 * middle finger is rising.
 */
const MIDDLE_DRAW_SUSPEND = 1.40;


/*
 * Fist hysteresis.
 *
 * Lower score = closed fist.
 */
const FIST_SCORE_HIGH = 0.65;
const FIST_SCORE_LOW = 0.85;


/*
 * Confirmation frames.
 *
 * DRAW requires a small confirmation window.
 * ERASE requires a slightly longer one because it is destructive.
 */
const DRAW_CONFIRM_FRAMES = 2;
const ERASE_CONFIRM_FRAMES = 3;


/* ============================================================
 * Gesture state
 * ============================================================ */

function createGestureState() {
    return {
        indexExtended: false,
        middleExtended: false,
        fistActive: false,

        drawConfirmCount: 0,
        eraseConfirmCount: 0,

        /*
         * True only while the current gesture is DRAW and the
         * middle finger is physically rising toward STOP.
         */
        suspendDraw: false
    };
}


/* ============================================================
 * Gesture recognition
 * ============================================================
 *
 * Gestures:
 *
 *   ☝  -> DRAW
 *   ✌  -> STOP
 *   ✊  -> ERASE
 *   NONE -> no action
 *
 * The returned values are mutually exclusive.
 */
function recognizeGesture(handsLandmarks, state) {
    /*
     * No hand.
     */
    if (!handsLandmarks || handsLandmarks.length === 0) {
        state.indexExtended = false;
        state.middleExtended = false;
        state.fistActive = false;

        state.drawConfirmCount = 0;
        state.eraseConfirmCount = 0;
        state.suspendDraw = false;

        return "NONE";
    }

    const landmarks = handsLandmarks[0];

    if (!landmarks || landmarks.length < 21) {
        state.indexExtended = false;
        state.middleExtended = false;
        state.fistActive = false;
        state.drawConfirmCount = 0;
        state.eraseConfirmCount = 0;
        state.suspendDraw = false;

        return "NONE";
    }


    /* ------------------------------------------------------------
     * Measure the hand.
     * ------------------------------------------------------------ */

    const indexRatio = fingerExtensionRatio(
        landmarks,
        8,  // index tip
        5   // index MCP
    );

    const middleRatio = fingerExtensionRatio(
        landmarks,
        12, // middle tip
        9   // middle MCP
    );

    const score = fistScore(landmarks);


    /* ------------------------------------------------------------
     * Index hysteresis.
     * ------------------------------------------------------------ */

    if (state.indexExtended) {
        if (indexRatio < INDEX_EXTEND_LOW) {
            state.indexExtended = false;
        }
    } else if (indexRatio > INDEX_EXTEND_HIGH) {
        state.indexExtended = true;
    }


    /* ------------------------------------------------------------
     * Middle hysteresis.
     * ------------------------------------------------------------ */

    if (state.middleExtended) {
        if (middleRatio < MIDDLE_EXTEND_LOW) {
            state.middleExtended = false;
        }
    } else if (middleRatio > MIDDLE_EXTEND_HIGH) {
        state.middleExtended = true;
    }


    /* ------------------------------------------------------------
     * Fist hysteresis.
     * ------------------------------------------------------------ */

    if (state.fistActive) {
        if (score > FIST_SCORE_LOW) {
            state.fistActive = false;
        }
    } else if (score < FIST_SCORE_HIGH) {
        state.fistActive = true;
    }


    /* ------------------------------------------------------------
     * Hard gesture classification.
     *
     * A fist must NOT simultaneously contain a clearly extended
     * index or middle finger.
     *
     * This is important because noisy landmarks can occasionally
     * produce a low fist score while one finger is actually moving
     * into DRAW/STOP.
     * ------------------------------------------------------------ */

    const isStopGesture =
        state.indexExtended &&
        state.middleExtended;

    const isDrawGesture =
        state.indexExtended &&
        !state.middleExtended;

    const isEraseGesture =
        state.fistActive &&
        !state.indexExtended &&
        !state.middleExtended;


    /* ------------------------------------------------------------
     * DRAW suspension.
     *
     * Only relevant when we are actually in a pointing configuration.
     * A rising middle finger temporarily freezes drawing until the
     * gesture becomes STOP or settles back into DRAW.
     * ------------------------------------------------------------ */

    state.suspendDraw =
        isDrawGesture &&
        middleRatio > MIDDLE_DRAW_SUSPEND;


    /* ------------------------------------------------------------
     * ERASE confirmation.
     * ------------------------------------------------------------ */

    if (isEraseGesture) {
        state.eraseConfirmCount = Math.min(
            state.eraseConfirmCount + 1,
            ERASE_CONFIRM_FRAMES
        );
    } else {
        state.eraseConfirmCount = 0;
    }


    /*
     * Once a fist has been confirmed for the required number of
     * frames, ERASE wins.
     *
     * This is intentionally checked only after the hard
     * "closed fist" conditions above have been satisfied.
     */
    if (state.eraseConfirmCount >= ERASE_CONFIRM_FRAMES) {
        state.drawConfirmCount = 0;
        return "ERASE";
    }


    /* ------------------------------------------------------------
     * STOP
     * ------------------------------------------------------------ */

    if (isStopGesture) {
        /*
         * STOP is non-destructive and must be immediate.
         */
        state.drawConfirmCount = 0;

        return "STOP";
    }
    /* ------------------------------------------------------------
     * DRAW
     * ------------------------------------------------------------ */

    if (isDrawGesture) {
        /*
         * Never accumulate DRAW confirmation while the middle finger
         * is physically rising toward STOP.
         */
        if (state.suspendDraw) {
            state.drawConfirmCount = 0;
            return "NONE";
        }

        state.drawConfirmCount = Math.min(
            state.drawConfirmCount + 1,
            DRAW_CONFIRM_FRAMES
        );

        if (state.drawConfirmCount >= DRAW_CONFIRM_FRAMES) {
            return "DRAW";
        }

        return "NONE";
    }


    /* ------------------------------------------------------------
     * No recognized gesture.
     * ------------------------------------------------------------ */

    state.drawConfirmCount = 0;

    return "NONE";
}


/* ============================================================
 * Index fingertip
 * ============================================================ */

function getIndexFingerTip(handsLandmarks) {
    if (!handsLandmarks || handsLandmarks.length === 0) {
        return null;
    }

    const landmarks = handsLandmarks[0];

    if (!landmarks || !landmarks[8]) {
        return null;
    }

    const tip = landmarks[8];

    return {
        x: tip.x,
        y: tip.y
    };
}


/* ============================================================
 * Coordinate mapping
 * ============================================================ */

function mapToCanvasCoordinates(
    normalizedX,
    normalizedY,
    canvasWidth,
    canvasHeight,
    mirrorX = true
) {
    const x = mirrorX
        ? (1 - normalizedX) * canvasWidth
        : normalizedX * canvasWidth;

    return {
        x,
        y: normalizedY * canvasHeight
    };
}


/* ============================================================
 * One Euro Filter
 * ============================================================ */

function lowPassAlpha(cutoff, dt) {
    const safeCutoff = Math.max(cutoff, 0.001);
    const tau = 1 / (2 * Math.PI * safeCutoff);

    return 1 / (1 + tau / Math.max(dt, 0.001));
}

function createOneEuroState() {
    return {
        initialized: false,
        xPrev: 0,
        dxPrev: 0,
        tPrev: 0
    };
}

function oneEuroFilter(
    state,
    value,
    timestampMs,
    minCutoff,
    beta,
    dCutoff
) {
    const timestampSeconds = timestampMs / 1000;

    if (!state.initialized) {
        state.initialized = true;
        state.xPrev = value;
        state.dxPrev = 0;
        state.tPrev = timestampSeconds;

        return value;
    }

    const dt = Math.max(
        timestampSeconds - state.tPrev,
        0.001
    );

    const rawVelocity =
        (value - state.xPrev) / dt;

    const velocityAlpha =
        lowPassAlpha(dCutoff, dt);

    const filteredVelocity =
        state.dxPrev +
        velocityAlpha *
        (rawVelocity - state.dxPrev);

    const cutoff =
        minCutoff +
        beta * Math.abs(filteredVelocity);

    const positionAlpha =
        lowPassAlpha(cutoff, dt);

    const filteredValue =
        state.xPrev +
        positionAlpha *
        (value - state.xPrev);

    state.xPrev = filteredValue;
    state.dxPrev = filteredVelocity;
    state.tPrev = timestampSeconds;

    return filteredValue;
}


/* ============================================================
 * Smoothing configuration
 * ============================================================ */

const AI_SMOOTHING_MIN_CUTOFF = 1.15;
const AI_SMOOTHING_BETA = 0.045;
const AI_SMOOTHING_D_CUTOFF = 1.2;


/* ============================================================
 * Tracking outlier rejection
 * ============================================================ */

const AI_MAX_VELOCITY_DIAGONALS_PER_SEC = 8;
const AI_MAX_CONSECUTIVE_OUTLIERS = 2;

function createTrackingState() {
    return {
        lastRaw: null,
        lastTimestampMs: null,
        consecutiveOutliers: 0,

        filterX: createOneEuroState(),
        filterY: createOneEuroState()
    };
}

function resetTrackingState(trackingState) {
    trackingState.lastRaw = null;
    trackingState.lastTimestampMs = null;
    trackingState.consecutiveOutliers = 0;

    trackingState.filterX = createOneEuroState();
    trackingState.filterY = createOneEuroState();
}


/* ============================================================
 * Point stabilization
 *
 * MediaPipe landmark
 *       -> velocity validation
 *       -> One Euro smoothing
 *       -> stable canvas point
 * ============================================================ */

function stabilizePoint(
    trackingState,
    rawPosition,
    timestampMs,
    canvasWidth,
    canvasHeight
) {
    const canvasDiagonal =
        Math.hypot(
            canvasWidth,
            canvasHeight
        );

    const maxVelocity =
        canvasDiagonal *
        AI_MAX_VELOCITY_DIAGONALS_PER_SEC;

    if (
        trackingState.lastRaw &&
        trackingState.lastTimestampMs != null
    ) {
        const dt = Math.max(
            (timestampMs - trackingState.lastTimestampMs) / 1000,
            0.001
        );

        const rawDistance =
            distance(
                rawPosition,
                trackingState.lastRaw
            );

        const velocity =
            rawDistance / dt;

        if (velocity > maxVelocity) {
            trackingState.consecutiveOutliers += 1;

            if (
                trackingState.consecutiveOutliers <
                AI_MAX_CONSECUTIVE_OUTLIERS
            ) {
                return null;
            }

            resetTrackingState(trackingState);
        }
    }

    trackingState.consecutiveOutliers = 0;

    trackingState.lastRaw = {
        x: rawPosition.x,
        y: rawPosition.y
    };

    trackingState.lastTimestampMs = timestampMs;

    return {
        x: oneEuroFilter(
            trackingState.filterX,
            rawPosition.x,
            timestampMs,
            AI_SMOOTHING_MIN_CUTOFF,
            AI_SMOOTHING_BETA,
            AI_SMOOTHING_D_CUTOFF
        ),

        y: oneEuroFilter(
            trackingState.filterY,
            rawPosition.y,
            timestampMs,
            AI_SMOOTHING_MIN_CUTOFF,
            AI_SMOOTHING_BETA,
            AI_SMOOTHING_D_CUTOFF
        )
    };
}


/* ============================================================
 * Drawing thresholds
 * ============================================================ */

const AI_MIN_SEGMENT_DISTANCE = 1.5;
const AI_INTERP_STEP = 12;


/* ============================================================
 * Chat message timestamp helpers
 * ============================================================ */

function getMessageTimestamp(message) {
    return (
        message?.created_at ||
        message?.createdAt ||
        message?.timestamp ||
        message?.sent_at ||
        message?.sentAt ||
        message?.time ||
        message?.date ||
        message?.sent_time ||
        message?.message_time ||
        null
    );
}

function formatMessageTime(value) {
    if (!value && value !== 0) {
        return "";
    }

    const normalized =
        typeof value === "number" &&
        value < 10000000000
            ? value * 1000
            : value;

    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export default function Classroom() {
    const { id } = useParams();
    const navigate = useNavigate();
    const micPeerConnectionsRef = useRef({});
    const localMicStreamRef = useRef(null);
    const isMicOnRef = useRef(false);
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const socketRef = useRef(null);
    const lastPositionRef = useRef(null);
    const videoRef = useRef(null);
    const peerConnectionsRef = useRef({});
    const iceCandidatesQueueRef = useRef({});
    const localStreamRef = useRef(null);
    const boardFileRef = useRef(null);
    const fileInputRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const token = localStorage.getItem("token");

    let accountRole = "";
    let accountName = "";

    if (token) {
        try {
            const decodedToken = jwtDecode(token);

            accountRole = decodedToken.role || "";
            accountName = decodedToken.username || "Student";

        } catch (error) {
            console.error(
                "Failed to decode token:",
                error
            );
            accountName = "Student";
        }
    }

    const [classroom, setClassroom] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [selectedColor, setSelectedColor] =
    useState("#000000");
    const [memberPermissions, setMemberPermissions] = useState({});
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(Number(
        token ? jwtDecode(token).user_id : null
    ));
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const chatContainerRef = useRef(null);
    const [boardFile, setBoardFile] = useState(null);
    const [pdfInteractive, setPdfInteractive] = useState(true);
    const [pdfObjectUrl, setPdfObjectUrl] = useState(null);
    const [tool, setTool] = useState("pen");
    const [eraserSize, setEraserSize] = useState(25)
    const [penSize, setPenSize] = useState(3);
    const [boardMode, setBoardMode] = useState("whiteboard");
    const boardModeRef = useRef(boardMode);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [canDraw, setCanDraw] = useState(
    accountRole === "teacher"
    );
    const [isKicked, setIsKicked] = useState(false);
    const [rejoinRequested, setRejoinRequested] = useState(false);
    const [canSpeak, setCanSpeak] = useState(accountRole === "teacher");
    const [isMicOn, setIsMicOn] = useState(false);
    const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
    const [micPermissions, setMicPermissions] = useState({});
    const [raisedHands, setRaisedHands] = useState({});

    // --- AI input mode (hand-tracking as an alternative to mouse) ---
    const [inputMode, setInputMode] = useState("mouse"); // "mouse" | "ai"
    const [aiStatus, setAiStatus] = useState("idle"); // idle | loading | ready | error
    const [aiErrorMessage, setAiErrorMessage] = useState("");
    const [aiGesture, setAiGesture] = useState("NONE");
    const aiVideoRef = useRef(null);
    const aiStreamRef = useRef(null);
    const handLandmarkerRef = useRef(null);
    const aiRafRef = useRef(null);
    const aiActiveRef = useRef(false);
    const gestureStateRef = useRef(createGestureState());
    const trackingStateRef = useRef(createTrackingState());
    const aiCursorDotRef = useRef(null);
    const lastAiGestureRef = useRef("NONE");

    // Kept in sync so the AI loop (which lives inside a longer-running
    // effect) always sees current settings instead of a stale snapshot
    // from whenever that effect last started - same pattern as boardModeRef.
    const drawingSettingsRef = useRef({
        selectedColor,
        tool,
        penSize,
        eraserSize
    });

    useEffect(() => {
        drawingSettingsRef.current = {
            selectedColor,
            tool,
            penSize,
            eraserSize
        };
    }, [selectedColor, tool, penSize, eraserSize]);

    useEffect(() => {
        boardModeRef.current = boardMode;
    }, [boardMode]);

    useEffect(() => {
        if (!token) {
            navigate("/");
            return;
        }

        let mounted = true; 

        async function loadClassroom(){
            try {
                const response = await api.get(
                    `/classrooms/${id}`,
                    {
                        headers: {
                            Authorization:
                                "Bearer " + token
                        }
                    }
                );

                if (mounted) {
                    setClassroom(response.data);
                }
            } catch (error) {
                console.error(
                    "Failed to load classroom:",
                    error
                );
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        }

        async function loadMembers() {
            try {
                const response = await api.get(
                    `/classrooms/${id}/members`,
                    {
                        headers: {
                            Authorization:
                                "Bearer " + token
                        }
                    }
                );

                if (mounted) {
                    if (
                        Array.isArray(
                            response.data
                        )
                    ) {
                        setMembers(response.data);
                    } else {
                        setMembers([]);
                    }
                }
            } catch (error) {
                console.error(
                    "Failed to load members:",
                    error
                );

                if (mounted) {
                    setMembers([]);
                }
            }
        }

async function loadChatMessages() {
    try {
        const response = await api.get(
            `/chat/${id}`,
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        if (mounted && Array.isArray(response.data)) {
            setChatMessages((prev) => [
                ...response.data.map((item) => ({
                    ...item,
                    timestamp: getMessageTimestamp(item)
                })),
                ...prev
            ]);
        }
    } catch (error) {
        console.error(
            "Failed to load chat history:",
            error
        );
    }
}

async function loadWhiteboardPermissions() {
    try {
        const response = await api.get(
            `/classrooms/${id}/whiteboard/permissions`,
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const permissions = {};

        response.data.forEach((permission) => {
            permissions[permission.user_id] =
                permission.can_draw;
        });

        setMemberPermissions(permissions);

        if (permissions[currentUserId] !== undefined) {
            setCanDraw(permissions[currentUserId]);
        }

    } catch (error) {
        console.error(
            "Failed to load whiteboard permissions:",
            error
        );
    }
 }

        loadClassroom();
        loadMembers();
        loadChatMessages();
        loadWhiteboardPermissions();
        loadMicPermissions();

        return () => {
            mounted = false;
        };
    }, [id, token, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

async function createPeerConnection(
    targetUserId,
    stream = null,
    createOffer = false,
    kind = "video"
) {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not connected");
        return null;
    }

    const connectionsRef =
        kind === "audio" ? micPeerConnectionsRef : peerConnectionsRef;

    let peer = connectionsRef.current[targetUserId];

    if (peer) {
        // Connection already exists. If we now have a stream to add
        // (e.g. a student just got mic permission on a connection that
        // was so far receive-only), add its tracks and renegotiate.
        if (stream) {
            const existingTrackIds = new Set(
                peer.getSenders()
                    .map((sender) => sender.track?.id)
                    .filter(Boolean)
            );

            let addedTrack = false;

            stream.getTracks().forEach((track) => {
                if (!existingTrackIds.has(track.id)) {
                    peer.addTrack(track, stream);
                    addedTrack = true;
                }
            });

            if (addedTrack && createOffer) {
                try {
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);

                    socket.send(JSON.stringify({
                        type: "webrtc_offer",
                        target_user_id: targetUserId,
                        offer: peer.localDescription,
                        kind
                    }));
                } catch (error) {
                    console.error("Failed to renegotiate offer:", error);
                }
            }
        }

        return peer;
    }

    peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    connectionsRef.current[targetUserId] = peer;

    peer.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", kind, targetUserId, peer.iceConnectionState);
    };
    peer.onconnectionstatechange = () => {
        console.log("Peer connection state:", kind, targetUserId, peer.connectionState);
    };

    if (stream) {
        stream.getTracks().forEach((track) => {
            peer.addTrack(track, stream);
        });
    }

    peer.ontrack = (event) => {
        console.log("Received remote track from:", targetUserId, kind, event.track.kind);

        let remoteStream = peer.remoteStream || new MediaStream();
        peer.remoteStream = remoteStream;

        if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
            remoteStream.addTrack(event.track);
        }

        const setStreams =
            kind === "audio" ? setRemoteAudioStreams : setRemoteStreams;

        setStreams((prev) => ({
            ...prev,
            [targetUserId]: remoteStream
        }));

        event.track.onunmute = () => {
            setStreams((prev) => ({
                ...prev,
                [targetUserId]: remoteStream
            }));
        };

        event.track.onended = () => {
            console.log("Remote track ended:", kind, event.track.kind);
        };
    };

    peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        if (socket.readyState !== WebSocket.OPEN) return;

        socket.send(JSON.stringify({
            type: "webrtc_ice_candidate",
            target_user_id: targetUserId,
            candidate: event.candidate,
            kind
        }));
    };

    if (createOffer) {
        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            socket.send(JSON.stringify({
                type: "webrtc_offer",
                target_user_id: targetUserId,
                offer: peer.localDescription,
                kind
            }));
        } catch (error) {
            console.error("Failed to create/send offer:", error);
        }
    }

    return peer;
}

 const getLocalCameraStream = useCallback(async () => {
        if (accountRole !== "teacher") {
            console.warn(
                "Camera access denied: only the teacher can share the camera."
            );
            return null;
        }

        if (localStreamRef.current) {
            return localStreamRef.current;
        }

        try {
            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 320,
                        height: 240
                    },
                    audio: false
                });

            localStreamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            return stream;

        } catch (error) {
            console.error(
                "Failed to get teacher camera stream:",
                error
            );

            return null;
        }
    }, [accountRole]);



    /*logic for socket connection and drawing events can be added here*/
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token || !id) {
        return;
    }

    const socket = new WebSocket(
        `${WS_URL}/ws/${id}?token=${encodeURIComponent(token)}`
    );

    socketRef.current = socket;

    socket.onopen = () => {
        console.log("WebSocket connected");
    };

socket.onmessage = async (event) => {
      try {
          const message = JSON.parse(event.data);

          if (message.type === "online_users") {

      setOnlineUsers(message.users || []);

      setCurrentUserId(
         message.current_user_id
      );
 
     return;
    }
    if (message.type === "board_mode") {
        setBoardMode(message.mode);

        if (message.mode !== "camera") {

            Object.values(peerConnectionsRef.current).forEach(
                (pc) => pc.close()
            );

            peerConnectionsRef.current = {};

            setRemoteStreams({});

            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = null;
            }
        }

        return;
    }

    if (message.type === "board_file") {
    boardFileRef.current = {
        dataUrl: message.file_data,
        name: message.file_name
    };

    setBoardFile(boardFileRef.current);
    setPdfInteractive(true);

    return;
 }
    if (message.type === "chat") {
        setChatMessages((prev) => [
            ...prev,
            {
                sender: message.sender,
                role: message.role,
                message: message.message,
                timestamp: getMessageTimestamp(message)
            }
        ]);

        return;
    }

    if (message.type === "student_kicked") {

        const kickedUserId = Number(
            message.user_id ?? message.student_id ?? message.id
        );

        const isSelf =
            !Number.isNaN(kickedUserId) &&
            kickedUserId === Number(currentUserId);

        if (!Number.isNaN(kickedUserId)) {
            setMembers((prev) =>
                prev.filter((member) => {
                    const memberId =
                        member.user_id ||
                        member.user?.id ||
                        member.id;
                    return Number(memberId) !== kickedUserId;
                })
            );

            setOnlineUsers((prev) =>
                prev.filter(
                    (user) => Number(user.id) !== kickedUserId
                )
            );

            setRaisedHands((prev) => {
                const next = { ...prev };
                delete next[kickedUserId];
                return next;
            });
        }

        if (!isSelf) {
            // Someone else was kicked: only tear down the pieces of
            // state that belong to them. Everything else (my own
            // camera/mic and other connections) stays untouched.
            const videoPeer =
                peerConnectionsRef.current[kickedUserId];

            if (videoPeer) {
                videoPeer.close();
                delete peerConnectionsRef.current[kickedUserId];
            }

            const micPeer =
                micPeerConnectionsRef.current[kickedUserId];

            if (micPeer) {
                micPeer.close();
                delete micPeerConnectionsRef.current[kickedUserId];
            }

            delete iceCandidatesQueueRef.current[
                `video_${kickedUserId}`
            ];
            delete iceCandidatesQueueRef.current[
                `audio_${kickedUserId}`
            ];

            setRemoteStreams((prev) => {
                const next = { ...prev };
                delete next[kickedUserId];
                return next;
            });

            setRemoteAudioStreams((prev) => {
                const next = { ...prev };
                delete next[kickedUserId];
                return next;
            });

            return;
        }

        console.warn("You have been kicked from the classroom.");

        setIsKicked(true);
        setCanDraw(false);

        // توقف دوربین خود کاربر، اگر چیزی باز باشد
        const stream = localStreamRef.current;

        if (stream) {
            stream.getTracks().forEach((track) => {
                track.stop();
            });

            localStreamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        // بستن تمام WebRTC connectionها
        Object.values(peerConnectionsRef.current).forEach(
            (pc) => pc.close()
        );

        peerConnectionsRef.current = {};

        iceCandidatesQueueRef.current = {};

        setRemoteStreams({});

        const micStream = localMicStreamRef.current;
        if (micStream) {
            micStream.getTracks().forEach((track) => track.stop());
            localMicStreamRef.current = null;
        }
        Object.values(micPeerConnectionsRef.current).forEach((pc) => pc.close());
        micPeerConnectionsRef.current = {};
        isMicOnRef.current = false;
        setIsMicOn(false);
        setRemoteAudioStreams({});

        return;
    }
    if (message.type === "webrtc_offer") {
        const fromUserId = message.from_user_id;
        const kind = message.kind || "video";

        console.log(
            "Received WebRTC offer from:",
            fromUserId,
            "| kind:",
            kind
        );

        const connectionsRef =
            kind === "audio"
                ? micPeerConnectionsRef
                : peerConnectionsRef;

        let peerConnection =
            connectionsRef.current[fromUserId];

        // اگر connection مربوط به این نوع وجود ندارد، بساز
        if (!peerConnection) {
            peerConnection =
                await createPeerConnection(
                    fromUserId,
                    null,
                    false,
                    kind
                );
        }

        if (!peerConnection) {
            console.error(
                "Failed to create peer connection:",
                fromUserId,
                "| kind:",
                kind
            );
            return;
        }

        try {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    message.offer
                )
            );

            // Queue مربوط به همین نوع connection
            const queueKey =
                `${kind}_${fromUserId}`;

            const queuedCandidates =
                iceCandidatesQueueRef.current[queueKey] || [];

            for (const candidate of queuedCandidates) {
                try {
                    await peerConnection.addIceCandidate(
                        new RTCIceCandidate(candidate)
                    );
                } catch (error) {
                    console.error(
                        "Failed to add queued ICE candidate:",
                        error
                    );
                }
            }

            delete iceCandidatesQueueRef.current[
                queueKey
            ];

            const answer =
                await peerConnection.createAnswer();

            await peerConnection.setLocalDescription(
                answer
            );

            const socket =
                socketRef.current;

            if (
                socket &&
                socket.readyState === WebSocket.OPEN
            ) {
                socket.send(
                    JSON.stringify({
                        type: "webrtc_answer",
                        target_user_id: fromUserId,
                        answer:
                            peerConnection.localDescription,
                        kind: kind
                    })
                );

                console.log(
                    "WebRTC answer sent to:",
                    fromUserId,
                    "| kind:",
                    kind
                );
            }

        } catch (error) {
            console.error(
                "Failed to handle WebRTC offer:",
                error
            );
        }

        return;
    }
if (message.type === "webrtc_ice_candidate") {
    const fromUserId = message.from_user_id;
    const kind = message.kind || "video";

    // انتخاب connection مناسب بر اساس نوع ارتباط
    const connectionsRef =
        kind === "audio"
            ? micPeerConnectionsRef
            : peerConnectionsRef;

    const peerConnection =
        connectionsRef.current[fromUserId];

    if (!peerConnection) {
        console.warn(
            "Peer connection not ready for ICE candidate:",
            fromUserId,
            "| kind:",
            kind
        );

        // Queue جدا برای audio و video
        const queueKey = `${kind}_${fromUserId}`;

        if (
            !iceCandidatesQueueRef.current[queueKey]
        ) {
            iceCandidatesQueueRef.current[queueKey] = [];
        }

        iceCandidatesQueueRef.current[
            queueKey
        ].push(message.candidate);

        return;
    }

    try {
        if (peerConnection.remoteDescription) {

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(
                    message.candidate
                )
            );

            console.log(
                "ICE candidate added from:",
                fromUserId,
                "| kind:",
                kind
            );

        } else {

            console.log(
                "Queueing ICE candidate from:",
                fromUserId,
                "| kind:",
                kind
            );

            const queueKey = `${kind}_${fromUserId}`;

            if (
                !iceCandidatesQueueRef.current[
                    queueKey
                ]
            ) {
                iceCandidatesQueueRef.current[
                    queueKey
                ] = [];
            }

            iceCandidatesQueueRef.current[
                queueKey
            ].push(message.candidate);
        }

    } catch (error) {

        console.error(
            "Failed to add ICE candidate:",
            error
        );
    }

    return;
}

if (message.type === "webrtc_answer") {

    const fromUserId =
        message.from_user_id;

    const kind =
        message.kind || "video";

    console.log(
        "Received WebRTC answer from:",
        fromUserId,
        "| kind:",
        kind
    );

    const connectionsRef =
        kind === "audio"
            ? micPeerConnectionsRef
            : peerConnectionsRef;

    const peerConnection =
        connectionsRef.current[fromUserId];

    if (!peerConnection) {

        console.warn(
            "No peer connection for answer from:",
            fromUserId,
            "| kind:",
            kind
        );

        return;
    }

    try {

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                message.answer
            )
        );

        console.log(
            "Remote description set:",
            fromUserId,
            "| kind:",
            kind
        );

        const queueKey =
            `${kind}_${fromUserId}`;

        const queued =
            iceCandidatesQueueRef.current[
                queueKey
            ] || [];

        for (const candidate of queued) {

            try {

                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );

            } catch (error) {

                console.error(
                    "Failed to add queued ICE candidate:",
                    error
                );
            }
        }

        delete iceCandidatesQueueRef.current[
            queueKey
        ];

    } catch (error) {

        console.error(
            "Failed to set remote description from answer:",
            error
        );
    }

    return;
}

if (message.type === "mic_permission") {
    setCanSpeak(message.can_speak);

    if (!message.can_speak) {
        stopMic();
    }

    return;
}

if (message.type === "raise_hand") {
    const raisedUserId = Number(
        message.user_id ?? message.student_id ?? message.id
    );

    if (!Number.isNaN(raisedUserId)) {
        setRaisedHands((prev) => ({
            ...prev,
            [raisedUserId]: Boolean(message.raised)
        }));
    }

    return;
}

 if (message.type === "whiteboard_permission") {

    setCanDraw(message.can_draw);

    // اگر اجازه گرفته شد، ابزار پیش‌فرض قلم باشد
    if (message.can_draw) {
        setTool("pen");
    }

    // اگر اجازه گرفته شد، ولی بعداً گرفته شد
    if (!message.can_draw) {
        setTool(null);
    }

    return;
 }
    if (message.type === "user_join") {

        const joinedUserId = Number(message.user_id);

        setOnlineUsers((prev) => {

            if (
                prev.some(
                    (user) =>
                        Number(user.id) === joinedUserId
                )
            ) {
                return prev;
            }

            return [
                ...prev,
                {
                    id: joinedUserId,
                    username: message.username,
                    role: message.role
                }
            ];
        });

        /*
        * Only the teacher should initiate camera sharing.
        */
        if (
            accountRole === "teacher" &&
            isMicOnRef.current &&
            joinedUserId !== Number(currentUserId)
        ) {
            setTimeout(async () => {
                try {
                    const stream = localMicStreamRef.current;
                    if (!stream) return;

                    await createPeerConnection(joinedUserId, stream, true, "audio");
                } catch (error) {
                    console.error("Failed to connect mic to new user:", error);
                }
            }, 500);
        }
        if (
            accountRole === "teacher" &&
            boardModeRef.current === "camera" &&
            joinedUserId !== Number(currentUserId)
        ) {
            setTimeout(async () => {

                try {

                    const stream =
                        await getLocalCameraStream();

                    if (!stream) {
                        return;
                    }

                    await createPeerConnection(
                        joinedUserId,
                        stream,
                        true
                    );

                } catch (error) {

                    console.error(
                        "Failed to connect camera to new user:",
                        error
                    );
                }

            }, 500);
        }

        /*
        * Sync current classroom state to a user who just joined,
        * so they don't miss board mode changes that already happened.
        */
        if (
            accountRole === "teacher" &&
            joinedUserId !== Number(currentUserId)
        ) {
            const socket = socketRef.current;

            if (
                socket &&
                socket.readyState === WebSocket.OPEN
            ) {
                socket.send(
                    JSON.stringify({
                        type: "board_mode",
                        target_user_id: joinedUserId,
                        mode: boardModeRef.current
                    })
                );
            }
        }

        /*
        * Send the currently shared file
        * to a user who joins later.
        */
        if (
            boardModeRef.current === "file" &&
            joinedUserId !== Number(currentUserId) &&
            boardFileRef.current
        ) {

            const socket = socketRef.current;

            if (
                socket &&
                socket.readyState === WebSocket.OPEN
            ) {

                socket.send(
                    JSON.stringify({
                        type: "board_file",
                        target_user_id: joinedUserId,
                        file_data:
                            boardFileRef.current.dataUrl,
                        file_name:
                            boardFileRef.current.name
                    })
                );
            }
        }

        return;
    }

 if (message.type === "user_leave") {

    const leftUserId = Number(message.user_id);

    setOnlineUsers((prev) =>
        prev.filter(
            (user) => user.id !== message.user_id
        )
    );

    setMembers((prev) =>
        prev.filter((member) => {
            const memberId =
                member.user_id ||
                member.user?.id ||
                member.id;
            return Number(memberId) !== leftUserId;
        })
    );

    setRaisedHands((prev) => {
        const next = { ...prev };
        delete next[leftUserId];
        return next;
    });

    // Close and forget any peer connection tied to the user who
    // left. Otherwise a later rejoin/refresh from that same user
    // silently reuses a dead connection object instead of getting
    // a fresh offer, which is why a returning student stayed on a
    // black screen even after the socket no longer reconnects.
    const videoPeer = peerConnectionsRef.current[leftUserId];
    if (videoPeer) {
        videoPeer.close();
        delete peerConnectionsRef.current[leftUserId];
    }

    const micPeer = micPeerConnectionsRef.current[leftUserId];
    if (micPeer) {
        micPeer.close();
        delete micPeerConnectionsRef.current[leftUserId];
    }

    delete iceCandidatesQueueRef.current[`video_${leftUserId}`];
    delete iceCandidatesQueueRef.current[`audio_${leftUserId}`];

    setRemoteStreams((prev) => {
        const next = { ...prev };
        delete next[leftUserId];
        return next;
    });

    setRemoteAudioStreams((prev) => {
        const next = { ...prev };
        delete next[leftUserId];
        return next;
    });

    return;
 }
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const context = canvas.getContext("2d");

        if (!context) {
            return;
        }
        if (message.type === "draw") {
          context.strokeStyle =
          message.color || "#000000";

         context.lineWidth =
         message.width || 1.2;

        context.beginPath();

         context.moveTo(
          message.prevX,
          message.prevY
           );

        context.lineTo(
           message.x,
           message.y
         );

         context.stroke();

         context.closePath();
        }

        if (message.type === "erase") {

          context.save();

          context.globalCompositeOperation =
          "destination-out";

          context.lineWidth =
          message.width || 25;

          context.beginPath();

          context.moveTo(
           message.prevX,
           message.prevY
         );

         context.lineTo(
           message.x,
           message.y
         );

         context.stroke();
 
         context.closePath();

          context.restore();
        }


        if (message.type === "clear") {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            context.clearRect(
                0,
                0,
                rect.width * dpr,
                rect.height * dpr
            );
        }
    } catch (error) {
        console.error(
            "Failed to process WebSocket message:",
            error
        );
    }
 };

    socket.onclose = () => {
        console.log("WebSocket disconnected");
    };

    return () => {
        socket.close();
        socketRef.current = null;
    };
}, [id, currentUserId, accountRole, getLocalCameraStream]);

async function getLocalMicStream() {
    if (!canSpeak) {
        console.warn("You don't have permission to use the microphone.");
        return null;
    }

    if (localMicStreamRef.current) {
        return localMicStreamRef.current;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localMicStreamRef.current = stream;
        return stream;
    } catch (error) {
        console.error("Failed to get microphone stream:", error);
        return null;
    }
}
async function startMic() {
    const stream = await getLocalMicStream();
    if (!stream) return;

    isMicOnRef.current = true;
    setIsMicOn(true);

    if (accountRole === "teacher") {
        for (const user of onlineUsers) {
            if (Number(user.id) === Number(currentUserId)) continue;

            try {
                await createPeerConnection(user.id, stream, true, "audio");
            } catch (error) {
                console.error("Failed to connect mic to user:", user.id, error);
            }
        }
    } else {
        const teacher = onlineUsers.find((user) => user.role === "teacher");

        if (!teacher) {
            console.warn("Teacher not found online.");
            return;
        }

        try {
            await createPeerConnection(teacher.id, stream, true, "audio");
        } catch (error) {
            console.error("Failed to connect mic to teacher:", error);
        }
    }
}
   function stopMic() {
    const stream = localMicStreamRef.current;
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
    }

    localMicStreamRef.current = null;
    isMicOnRef.current = false;
    setIsMicOn(false);

    Object.values(micPeerConnectionsRef.current).forEach((pc) => pc.close());
    micPeerConnectionsRef.current = {};

    setRemoteAudioStreams({});}
function toggleMic() {
    if (isMicOn) {
        stopMic();
    } else {
        startMic();
    } }

function toggleRaiseHand() {
    const nextRaised = !raisedHands[currentUserId];

    setRaisedHands((prev) => ({
        ...prev,
        [currentUserId]: nextRaised
    }));

    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
            JSON.stringify({
                type: "raise_hand",
                raised: nextRaised
            })
        );
    }
}
async function loadMicPermissions() {
    try {
        const response = await api.get(
            `/classrooms/${id}/mic/permissions`,
            { headers: { Authorization: "Bearer " + token } }
        );

        const permissions = {};

        response.data.forEach((permission) => {
            permissions[permission.user_id] = permission.can_speak;
        });

        setMicPermissions(permissions);

        if (permissions[currentUserId] !== undefined) {
            setCanSpeak(permissions[currentUserId]);
        }
    } catch (error) {
        console.error("Failed to load mic permissions:", error);
    }
}

/* chat */ 
function sendChatMessage() {
    const text = chatInput.trim();

    if (!text) {
        return;
    }

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    socket.send(
        JSON.stringify({
            type: "chat",
            message: text
        })
    );

    const myUsername =
        onlineUsers.find(
            (user) => Number(user.id) === Number(currentUserId)
        )?.username || "You";

    setChatMessages((prev) => [
        ...prev,
        {
            sender: myUsername,
            role: accountRole,
            message: text,
            timestamp: new Date().toISOString()
        }
    ]);

    setChatInput("");
}
useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop =
            chatContainerRef.current.scrollHeight;
    }
}, [chatMessages]);

/*
 * Chrome does not reliably render large `data:application/pdf;base64,...`
 * URIs inside an <iframe> (Firefox does). Converting the data URL to a
 * Blob and using an object URL fixes this consistently across browsers.
 * The data URL itself is still what's stored in boardFile/sent over the
 * WebSocket - this object URL only exists for local display.
 */
useEffect(() => {
    if (!boardFile?.dataUrl?.startsWith("data:application/pdf")) {
        return;
    }

    let cancelled = false;
    let objectUrl = null;

    fetch(boardFile.dataUrl)
        .then((response) => response.blob())
        .then((blob) => {
            if (cancelled) {
                return;
            }

            objectUrl = URL.createObjectURL(blob);
            setPdfObjectUrl(objectUrl);
        })
        .catch((error) => {
            console.error("Failed to prepare PDF for display:", error);
        });

    return () => {
        cancelled = true;

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
    };
}, [boardFile]);


async function handleBoardFileChange(event) {
    if (!canDraw) {
        return;
    }

    const file = event.target.files?.[0];
    event.target.value = ""; // allow picking the same file again later

    if (!file) {
        return;
    }

    if (accountRole !== "teacher") {
        console.warn("Only the teacher can share files with the classroom.");
        return;
    }

    const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
        console.error("File mode currently supports images and PDF files only.");
        return;
    }

    try {
        const dataUrl = isPdf
            ? await readFileAsDataUrl(file)
            : await downscaleImageFile(file, 1600, 0.82);

        boardFileRef.current = { dataUrl, name: file.name };
        setBoardFile(boardFileRef.current);
        setPdfInteractive(true);

        const socket = socketRef.current;

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
                JSON.stringify({
                    type: "board_file",
                    file_data: dataUrl,
                    file_name: file.name
                })
            );
        }
    } catch (error) {
        console.error("Failed to load selected file:", error);
    }
}

// Plain read, no image decoding/resizing - used for PDFs (and anything
// else that isn't a raster image downscaleImageFile can process).
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
    });
}

function downscaleImageFile(file, maxDimension, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const img = new Image();

            img.onload = () => {
                const scale = Math.min(
                    1,
                    maxDimension / Math.max(img.width, img.height)
                );

                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);

                const context = canvas.getContext("2d");
                context.fillStyle = "#ffffff"; // flatten transparent PNGs to white
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(img, 0, 0, canvas.width, canvas.height);

                resolve(canvas.toDataURL("image/jpeg", quality));
            };

            img.onerror = () => reject(new Error("Could not load image"));
            img.src = reader.result;
        };

        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
    });
}

    useEffect(() => {
        if (accountRole === "teacher") {
            return;
        }

        const video = remoteVideoRef.current;

        if (!video) {
            console.log("Remote video element not ready");
            return;
        }

        const streams = Object.values(remoteStreams);

        if (streams.length === 0) {
            console.log("No remote streams available");
            return;
        }

        const stream = streams[0];

        console.log(
            "ATTACHING REMOTE STREAM TO VIDEO",
            stream
        );

        video.srcObject = stream;

        video.onloadedmetadata = () => {
            console.log("VIDEO METADATA LOADED", {
                readyState: video.readyState,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight
            });

            video.play()
                .then(() => {
                    console.log("REMOTE VIDEO PLAYING", {
                        readyState: video.readyState,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight
                    });
                })
                .catch((error) => {
                    console.error(
                        "REMOTE VIDEO PLAY FAILED:",
                        error
                    );
                });
        };

        const playVideo = async () => {
            try {
                await video.play();

                console.log(
                    "REMOTE VIDEO PLAYING",
                    {
                        readyState: video.readyState,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight
                    }
                );
            } catch (error) {
                console.error(
                    "REMOTE VIDEO PLAY FAILED:",
                    error
                );
            }
        };

        playVideo();

        return () => {
            video.onloadedmetadata = null;
            video.oncanplay = null;
            video.onplaying = null;
            video.onerror = null;
        };

    }, [remoteStreams, accountRole, boardMode]);

async function startCameraSharing() {
    const stream =
        await getLocalCameraStream();

    if (!stream) {
        return;
    }

    for (const user of onlineUsers) {

        if (
            Number(user.id) ===
            Number(currentUserId)
        ) {
            continue;
        }

        try {
            await createPeerConnection(
                user.id,
                stream,
                true
            );

        } catch (error) {
            console.error(
                "Failed to connect camera to user:",
                user.id,
                error
            );
        }
    }
}

/* Load whiteboard strokes from the server and render them on the canvas
 */
useEffect(() => {

    async function loadWhiteboard() {

        if (!token || !id) {
            return;
        }

        try {

            const response = await api.get(
                `/classrooms/${id}/whiteboard`,
                {
                    headers: {
                        Authorization:
                            "Bearer " + token
                    }
                }
            );

            const strokes = response.data;

            const canvas = canvasRef.current;

            if (!canvas) {
                return;
            }

            const context =
                canvas.getContext("2d");

            if (!context) {
                return;
            }

            for (const stroke of strokes) {

             context.beginPath();

            if (stroke.stroke_type === "erase") {

             context.save();

            context.globalCompositeOperation =
              "destination-out";

             context.lineWidth =
               stroke.width || 25;

            } else {

                 context.save();
 
                 context.globalCompositeOperation =
                 "source-over";

                 context.strokeStyle =
                 stroke.color || "#000000";

                 context.lineWidth =
                 stroke.width || 1.2;
                }

            context.moveTo(
             stroke.prevX,
             stroke.prevY
            );

             context.lineTo(
              stroke.x,
             stroke.y
            );

             context.stroke();

             context.closePath();

             context.restore();
            }

            context.strokeStyle = "#000000";
            context.lineWidth = 1.2;

        } catch (error) {

            console.error(
                "Failed to load whiteboard:",
                error
            );
        }
    }

    loadWhiteboard();

 }, [id, token]);

/* stop camera */
function stopCamera() {

    const stream = localStreamRef.current;

    if (stream) {
        stream.getTracks().forEach((track) => {
            track.stop();
        });
    }

    localStreamRef.current = null;

    if (videoRef.current) {
        videoRef.current.srcObject = null;
    }

    Object.values(peerConnectionsRef.current).forEach(
        (pc) => {
            pc.close();
        }
    );

    peerConnectionsRef.current = {};
}

 /* Canvas setup
 */
 useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    function setupCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const cssWidth = rect.width;
        const cssHeight = rect.height;

        const pixelWidth = Math.round(cssWidth * dpr);
        const pixelHeight = Math.round(cssHeight * dpr);

        if (
            canvas.width !== pixelWidth ||
            canvas.height !== pixelHeight
        ) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;

            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
        }

        context.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );

        context.lineCap = "round";
        context.lineJoin = "round";
        context.imageSmoothingEnabled = true;

        context.lineWidth = 1.2;
    }

    setupCanvas();

    const resizeObserver = new ResizeObserver(() => {
        setupCanvas();
    });

    resizeObserver.observe(canvas);

    return () => {
        resizeObserver.disconnect();
    };
 }, [loading, classroom])

 /*
 * Get accurate mouse position
 */
 function getPointerPosition(event) {
    const canvas = canvasRef.current;

    if (!canvas) {
        return {
            x: 0,
            y: 0
        };
    }

    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX / (window.devicePixelRatio || 1),
        y: (event.clientY - rect.top) * scaleY / (window.devicePixelRatio || 1)
    };
 }



/*
 * Core of "start a stroke" - independent of where the coordinate came
 * from (mouse pointer event or AI fingertip). Returns true if a stroke
 * was actually started, so callers with DOM-specific bits (like
 * pointer capture) know whether to run those.
 */
const beginDrawingStroke = useCallback((position) => {
    if (!canDraw) {
        return false;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
        return false;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        return false;
    }

    drawingRef.current = true;
    lastPositionRef.current = position;

    context.strokeStyle = drawingSettingsRef.current.selectedColor;

    context.beginPath();

    context.moveTo(
        position.x,
        position.y
    );

    return true;
}, [canDraw]);

/*
 * Start drawing
 */
 function startDrawing(event) {
    const canvas = canvasRef.current;

    if (!canvas) {
        return;
    }
    if (!canDraw) {
        return;
    }
    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    const position = getPointerPosition(event);

    const started = beginDrawingStroke(position);

    if (started) {
        canvas.setPointerCapture?.(event.pointerId);
    }
}


/*
 * Draw
 */
/*
 * Core of "continue a stroke from previous to position" - independent
 * of input source. toolOverride lets AI force "pen" or "eraser" based
 * on the detected gesture regardless of which tool button is selected;
 * mouse passes null/undefined and uses whatever tool is currently active.
 */
const applyDrawingSegment = useCallback((position, previous, toolOverride) => {
    const canvas = canvasRef.current;

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    const settings = drawingSettingsRef.current;
    const activeTool = toolOverride || settings.tool;

    /*
     * Eraser
     */
    if (activeTool === "eraser") {

        context.save();

        context.globalCompositeOperation =
            "destination-out";

        context.lineWidth = settings.eraserSize;

        context.beginPath();

        context.moveTo(
            previous.x,
            previous.y
        );

        context.lineTo(
            position.x,
            position.y
        );

        context.stroke();

        context.closePath();

        context.restore();

        const socket = socketRef.current;

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                JSON.stringify({
                    type: "erase",

                    x: position.x,
                    y: position.y,

                    prevX: previous.x,
                    prevY: previous.y,

                    width: settings.eraserSize
                })
            );
        }

    }

    /*
     * Pen
     */
    else {

        if (activeTool === "pen") {
           context.globalCompositeOperation =
              "source-over";

            context.strokeStyle =
               settings.selectedColor;

             context.lineWidth = settings.penSize;
         }

           context.lineWidth = settings.penSize;

        context.beginPath();

        context.moveTo(
            previous.x,
            previous.y
        );

        context.lineTo(
            position.x,
            position.y
        );

        context.stroke();

        context.closePath();

        const socket = socketRef.current;

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                JSON.stringify({
                    type: "draw",

                    x: position.x,
                    y: position.y,

                    prevX: previous.x,
                    prevY: previous.y,

                    color: settings.selectedColor,

                    width: settings.penSize
                })
            );
        }
    }
}, []);

function draw(event) {
    if (!canDraw) {
        return;
    }
    if (!drawingRef.current) {
        return;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    const position = getPointerPosition(event);
    const previous = lastPositionRef.current;

    if (!previous) {
        lastPositionRef.current = position;
        return;
    }

    applyDrawingSegment(position, previous);

    lastPositionRef.current = position;
}


/*
 * Stop drawing
 */
const stopDrawing = useCallback((event) => {
    const canvas = canvasRef.current;

    drawingRef.current = false;
    lastPositionRef.current = null;

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (context) {
        context.closePath();
    }

    try {
        if (event?.pointerId !== undefined) {
            canvas.releasePointerCapture?.(
                event.pointerId
            );
        }
    } catch {
        // Pointer capture may already be released.
    }
}, []);

 /*
 * AI hand-tracking input mode.
 *
 * Gesture mapping:
 *
 *   ☝  -> DRAW
 *   ✌  -> STOP
 *   ✊  -> ERASE
 *
 * The AI uses the same drawing pipeline as mouse/pointer input:
 *
 *   beginDrawingStroke()
 *   applyDrawingSegment()
 *   stopDrawing()
 *
 * AI tracking has its own isolated camera stream and never interacts
 * with the existing WebRTC camera stream.
 */
useEffect(() => {
    if (inputMode !== "ai" || !canDraw) {
        return;
    }

    let cancelled = false;

    aiActiveRef.current = true;

    const videoElement = aiVideoRef.current;
    const cursorDotElement = aiCursorDotRef.current;
    const trackingState = trackingStateRef.current;

    /*
     * Reset all AI drawing state when this effect starts.
     */
    gestureStateRef.current = createGestureState();
    resetTrackingState(trackingState);
    lastAiGestureRef.current = "NONE";
    lastPositionRef.current = null;

    async function startAI() {
        setAiStatus("loading");
        setAiErrorMessage("");

        try {
            const {
                HandLandmarker,
                FilesetResolver
            } = await import("@mediapipe/tasks-vision");

            // Pinned to the same version as the @mediapipe/tasks-vision
            // dependency in package.json, so the WASM runtime always
            // matches the JS API it's paired with.
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
            );

            const handLandmarker =
                await HandLandmarker.createFromOptions(
                    vision,
                    {
                        baseOptions: {
                            modelAssetPath:
                                "/models/hand_landmarker.task",
                            delegate: "GPU"
                        },

                        runningMode: "VIDEO",

                        numHands: 1,

                        minHandDetectionConfidence: 0.6,
                        minHandPresenceConfidence: 0.6,
                        minTrackingConfidence: 0.6
                    }
                );

            if (cancelled) {
                handLandmarker.close();
                return;
            }

            handLandmarkerRef.current = handLandmarker;

            /*
             * AI camera is completely independent from WebRTC.
             */
            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 320,
                        height: 240
                    },
                    audio: false
                });

            if (cancelled) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                });

                handLandmarker.close();

                return;
            }

            aiStreamRef.current = stream;

            if (videoElement) {
                videoElement.srcObject = stream;

                try {
                    await videoElement.play();
                } catch (playError) {
                    console.warn(
                        "AI video autoplay was blocked:",
                        playError
                    );
                }
            }

            if (cancelled) {
                return;
            }

            setAiStatus("ready");

            /*
             * Main MediaPipe detection loop.
             */
            const detectLoop = () => {
                if (
                    cancelled ||
                    !aiActiveRef.current
                ) {
                    return;
                }

                const video = aiVideoRef.current;
                const landmarker = handLandmarkerRef.current;

                if (
                    video &&
                    landmarker &&
                    video.readyState >= 2
                ) {
                    const timestampMs = performance.now();

                    /*
                     * Detect hand.
                     */
                    const result =
                        landmarker.detectForVideo(
                            video,
                            timestampMs
                        );

                    /*
                     * Recognize exactly one gesture:
                     *
                     * DRAW
                     * STOP
                     * ERASE
                     * NONE
                     */
                    const gesture =
                        recognizeGesture(
                            result.landmarks,
                            gestureStateRef.current
                        );

                    /*
                     * Capture the previous gesture before updating
                     * the public gesture state.
                     */
                    const previousGesture =
                        lastAiGestureRef.current;

                    /*
                     * Update React UI only when the gesture changes.
                     */
                    if (
                        gesture !== previousGesture
                    ) {
                        lastAiGestureRef.current =
                            gesture;

                        setAiGesture(gesture);
                    }

                    /*
                     * Every gesture transition starts a fresh stroke.
                     *
                     * DRAW -> ERASE:
                     * never continue a pen stroke with eraser input.
                     *
                     * DRAW -> STOP:
                     * terminate the pen stroke immediately.
                     */
                    if (
                        gesture !== previousGesture
                    ) {
                        if (drawingRef.current) {
                            stopDrawing();
                        }

                        lastPositionRef.current = null;
                    }

                    /*
                     * Hand confidence.
                     */
                    const handConfidence =
                        result.handednesses?.[0]?.[0]?.score ?? 1;

                    /*
                     * Fingertip position.
                     */
                    const tip =
                        getIndexFingerTip(
                            result.landmarks
                        );

                    const canvas =
                        canvasRef.current;

                    let stabilized = null;

                    /*
                     * Cursor + coordinate stabilization.
                     */
                    if (
                        tip &&
                        canvas &&
                        handConfidence >= 0.5
                    ) {
                        const rect =
                            canvas.getBoundingClientRect();

                        const rawPosition =
                            mapToCanvasCoordinates(
                                tip.x,
                                tip.y,
                                rect.width,
                                rect.height,
                                true
                            );

                        stabilized =
                            stabilizePoint(
                                trackingStateRef.current,
                                rawPosition,
                                timestampMs,
                                rect.width,
                                rect.height
                            );

                        /*
                         * Cursor follows the last trusted point.
                         */
                        if (
                            stabilized !== null &&
                            aiCursorDotRef.current
                        ) {
                            aiCursorDotRef.current.style.display =
                                "block";

                            aiCursorDotRef.current.style.transform =
                                `translate(${stabilized.x - 6}px, ${stabilized.y - 6}px)`;
                        }
                    } else {
                        /*
                         * Tracking lost.
                         *
                         * Keep the cursor visually where it was,
                         * but reset smoothing so tracking resumes
                         * from a fresh reference point.
                         */
                        resetTrackingState(
                            trackingStateRef.current
                        );
                    }

                    /*
                     * Invalid tracking frame.
                     *
                     * Never connect two valid points through an
                     * untrusted/outlier frame.
                     */
                    if (
                        stabilized === null
                    ) {
                        if (drawingRef.current) {
                            stopDrawing();
                        }

                        lastPositionRef.current = null;
                    } else if (
                        gesture === "DRAW"
                    ) {
                        /*
                         * DRAW
                         *
                         * During the physical transition toward STOP,
                         * suspend drawing to prevent one final unwanted
                         * pen segment.
                         */
                        if (
                            gestureStateRef.current
                                .suspendDraw
                        ) {
                            if (drawingRef.current) {
                                stopDrawing();
                            }

                            lastPositionRef.current = null;
                        } else {
                            /*
                             * Start a new pen stroke if necessary.
                             */
                            if (
                                !drawingRef.current
                            ) {
                                beginDrawingStroke(
                                    stabilized
                                );

                                lastPositionRef.current =
                                    stabilized;
                            } else {
                                const previousPosition =
                                    lastPositionRef.current;

                                /*
                                 * Defensive guard.
                                 */
                                if (
                                    !previousPosition
                                ) {
                                    stopDrawing();

                                    beginDrawingStroke(
                                        stabilized
                                    );

                                    lastPositionRef.current =
                                        stabilized;
                                } else {
                                    const segmentDistance =
                                        distance(
                                            stabilized,
                                            previousPosition
                                        );

                                    /*
                                     * Ignore tiny tracking jitter.
                                     */
                                    if (
                                        segmentDistance <
                                        AI_MIN_SEGMENT_DISTANCE
                                    ) {
                                        // Intentionally ignored.
                                    }

                                    /*
                                     * Interpolate large movements.
                                     */
                                    else if (
                                        segmentDistance >
                                        AI_INTERP_STEP
                                    ) {
                                        const steps =
                                            Math.ceil(
                                                segmentDistance /
                                                AI_INTERP_STEP
                                            );

                                        let stepFrom =
                                            previousPosition;

                                        for (
                                            let i = 1;
                                            i <= steps;
                                            i++
                                        ) {
                                            const t =
                                                i / steps;

                                            const stepTo = {
                                                x:
                                                    previousPosition.x +
                                                    (
                                                        stabilized.x -
                                                        previousPosition.x
                                                    ) *
                                                    t,

                                                y:
                                                    previousPosition.y +
                                                    (
                                                        stabilized.y -
                                                        previousPosition.y
                                                    ) *
                                                    t
                                            };

                                            applyDrawingSegment(
                                                stepTo,
                                                stepFrom,
                                                "pen"
                                            );

                                            stepFrom =
                                                stepTo;
                                        }

                                        lastPositionRef.current =
                                            stabilized;
                                    } else {
                                        /*
                                         * Normal movement.
                                         */
                                        applyDrawingSegment(
                                            stabilized,
                                            previousPosition,
                                            "pen"
                                        );

                                        lastPositionRef.current =
                                            stabilized;
                                    }
                                }
                            }
                        }
                    } else if (
                        gesture === "ERASE"
                    ) {
                        /*
                         * ERASE
                         *
                         * The eraser is selected explicitly for every
                         * segment. It never inherits the previous tool.
                         */
                        if (
                            !drawingRef.current
                        ) {
                            beginDrawingStroke(
                                stabilized
                            );

                            lastPositionRef.current =
                                stabilized;
                        } else {
                            const previousPosition =
                                lastPositionRef.current;

                            if (
                                !previousPosition
                            ) {
                                stopDrawing();

                                beginDrawingStroke(
                                    stabilized
                                );

                                lastPositionRef.current =
                                    stabilized;
                            } else {
                                const segmentDistance =
                                    distance(
                                        stabilized,
                                        previousPosition
                                    );

                                /*
                                 * Ignore tiny jitter.
                                 */
                                if (
                                    segmentDistance <
                                    AI_MIN_SEGMENT_DISTANCE
                                ) {
                                    // Intentionally ignored.
                                }

                                /*
                                 * Interpolate fast eraser movement.
                                 */
                                else if (
                                    segmentDistance >
                                    AI_INTERP_STEP
                                ) {
                                    const steps =
                                        Math.ceil(
                                            segmentDistance /
                                            AI_INTERP_STEP
                                        );

                                    let stepFrom =
                                        previousPosition;

                                    for (
                                        let i = 1;
                                        i <= steps;
                                        i++
                                    ) {
                                        const t =
                                            i / steps;

                                        const stepTo = {
                                            x:
                                                previousPosition.x +
                                                (
                                                    stabilized.x -
                                                    previousPosition.x
                                                ) *
                                                t,

                                            y:
                                                previousPosition.y +
                                                (
                                                    stabilized.y -
                                                    previousPosition.y
                                                ) *
                                                t
                                        };

                                        applyDrawingSegment(
                                            stepTo,
                                            stepFrom,
                                            "eraser"
                                        );

                                        stepFrom =
                                            stepTo;
                                    }

                                    lastPositionRef.current =
                                        stabilized;
                                } else {
                                    /*
                                     * Normal eraser movement.
                                     */
                                    applyDrawingSegment(
                                        stabilized,
                                        previousPosition,
                                        "eraser"
                                    );

                                    lastPositionRef.current =
                                        stabilized;
                                }
                            }
                        }
                    } else {
                        /*
                         * STOP / NONE
                         *
                         * Neither state modifies the canvas.
                         */
                        if (drawingRef.current) {
                            stopDrawing();
                        }

                        lastPositionRef.current = null;
                    }
                }

                /*
                 * Schedule next frame.
                 */
                aiRafRef.current =
                    requestAnimationFrame(
                        detectLoop
                    );
            };

            /*
             * Start detection.
             */
            aiRafRef.current =
                requestAnimationFrame(
                    detectLoop
                );

        } catch (error) {
            console.error(
                "Failed to start AI hand tracking:",
                error
            );

            if (!cancelled) {
                setAiStatus("error");

                setAiErrorMessage(
                    error?.message ||
                    "Failed to start AI mode."
                );
            }
        }
    }

    startAI();

    /*
     * Cleanup.
     */
    return () => {
        cancelled = true;
        aiActiveRef.current = false;

        /*
         * Stop animation loop.
         */
        if (aiRafRef.current) {
            cancelAnimationFrame(
                aiRafRef.current
            );

            aiRafRef.current = null;
        }

        /*
         * Never leave a stroke open.
         */
        if (drawingRef.current) {
            stopDrawing();
        }

        lastPositionRef.current = null;

        /*
         * Stop AI camera.
         */
        const stream =
            aiStreamRef.current;

        if (stream) {
            stream
                .getTracks()
                .forEach((track) => {
                    track.stop();
                });

            aiStreamRef.current = null;
        }

        /*
         * Detach video.
         */
        if (videoElement) {
            videoElement.srcObject = null;
        }

        /*
         * Close MediaPipe.
         */
        if (handLandmarkerRef.current) {
            handLandmarkerRef.current.close();

            handLandmarkerRef.current = null;
        }

        /*
         * Reset gesture state.
         */
        gestureStateRef.current =
            createGestureState();

        resetTrackingState(
            trackingState
        );

        lastAiGestureRef.current =
            "NONE";

        /*
         * Reset cursor.
         */
        if (cursorDotElement) {
            cursorDotElement.style.display =
                "none";
        }

        setAiStatus("idle");
        setAiGesture("NONE");
    };
}, [
    inputMode,
    canDraw,
    beginDrawingStroke,
    applyDrawingSegment,
    stopDrawing
]);


    /*
     * Clear whiteboard
     */
    function clearWhiteboard() {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const context = canvas.getContext("2d");

        if (!context) {
            return;
        }

        const rect =
            canvas.getBoundingClientRect();

        /*
         * Context is already scaled by DPR,
         * so use CSS dimensions here.
         */
        context.clearRect(
            0,
            0,
            rect.width,
            rect.height
        );

        const socket = socketRef.current;

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                JSON.stringify({
                    type: "clear"
                })
            );
        }
    }

    /*out of board*/
    function goBack() {
        if (accountRole === "teacher") {
            navigate("/teacher-dashboard");
        } else {
            navigate("/student-dashboard");
        }
    }

    async function copyInviteCode() {
        if (!classroom?.invite_code) {
            return;
        }

        try {
            await navigator.clipboard.writeText(
                classroom.invite_code
            );

            setCopied(true);

            setTimeout(() => {
                setCopied(false);
            }, 2000);
        } catch (error) {
            console.error(
                "Failed to copy invite code:",
                error
            );
        }
    }

    async function changeBoardMode(mode) {

        if (!canDraw) {
            return;
        }

        if (
            mode === "camera" &&
            accountRole !== "teacher"
        ) {
            return;
        }

        setBoardMode(mode);

        if (mode === "file") {
            setPdfInteractive(true);
        }

        const socket = socketRef.current;

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                JSON.stringify({
                    type: "board_mode",
                    mode: mode
                })
            );
        }

        if (mode === "camera") {

            if (accountRole !== "teacher") {
                return;
            }

            await startCameraSharing();

        } else {

            if (accountRole === "teacher") {
                stopCamera();
            }
        }
    }

    function changeWhiteboardPermission(userId, canDraw) {

        const socket = socketRef.current;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            console.error("WebSocket is not connected");
            return;
        }

        socket.send(
            JSON.stringify({
                type: "permission",
                user_id: userId,
                can_draw: canDraw
            })
        );

        setMemberPermissions((prev) => ({
            ...prev,
            [userId]: canDraw
        }));
    }

function changeMicPermission(userId, canSpeak) {
    const socket = socketRef.current;

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        console.error("WebSocket is not connected");
        return;
    }

    console.log(
        "Sending mic permission:",
        userId,
        canSpeak
    );

    socket.send(
        JSON.stringify({
            type: "mic_permission",
            user_id: userId,
            can_speak: canSpeak
        })
    );

    setMicPermissions((prev) => ({
        ...prev,
        [userId]: canSpeak
    }));
}
    async function kickStudent(userId, username) {

        const confirmed = window.confirm(
            `Are you sure you want to remove ${username} from this classroom?`
        );

        if (!confirmed) {
            return;
        }

        try {

            await api.post(
                `/classrooms/${id}/members/${userId}/kick`,
                {},
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            // حذف از لیست آنلاین‌ها
            setOnlineUsers((prev) =>
                prev.filter(
                    (user) =>
                        Number(user.id) !== Number(userId)
                )
            );

            setMembers((prev) =>
                prev.filter((member) => {
                    const memberId =
                        member.user_id ||
                        member.user?.id ||
                        member.id;
                    return Number(memberId) !== Number(userId);
                })
            );

            console.log(
                "Student kicked:",
                userId
            );

        } catch (error) {

            console.error(
                "Failed to kick student:",
                error
            );

            alert(
                error.response?.data?.detail ||
                "Failed to remove student."
            );
        }
    }    
    if (isKicked) {
        return (
            <div
                style={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                        "radial-gradient(circle at 50% 0%, rgba(27, 67, 103, 0.2), transparent 35%), " +
                        "linear-gradient(145deg, #06101d, #091524)",
                    fontFamily: "'Vazirmatn', Tahoma, sans-serif"
                }}
            >
                <div
                    style={{
                        padding: "40px",
                        maxWidth: "440px",
                        width: "calc(100% - 40px)",
                        textAlign: "center",
                        background:
                            "linear-gradient(145deg, rgba(18, 37, 59, 0.85), rgba(8, 22, 37, 0.92))",
                        border: "1px solid rgba(255, 255, 255, 0.07)",
                        borderRadius: "17px",
                        boxShadow: "0 15px 40px rgba(0, 0, 0, 0.25)"
                    }}
                >
                    <h2 style={{ margin: "0 0 8px", color: "#f1eee5" }}>
                        You have been removed from this classroom.
                    </h2>

                    <p style={{ color: "#8b96a5", marginBottom: "20px" }}>
                        The teacher has removed you from the classroom.
                    </p>

                    {!rejoinRequested ? (
                        <button
                            type="button"
                            onClick={requestRejoin}
                            className="ncls-primary-btn"
                            style={{
                                padding: "10px 18px",
                                cursor: "pointer",
                                border: "1px solid rgba(93, 157, 198, 0.35)",
                                borderRadius: "6px",
                                background:
                                    "linear-gradient(135deg, #245b82, #173e5e)",
                                color: "#f1eee5",
                                fontSize: "0.95em"
                            }}
                        >
                            Request to Rejoin
                        </button>
                    ) : (
                        <p style={{ color: "#e0a458" }}>
                            ⏳ Your rejoin request is pending teacher approval.
                        </p>
                    )}

                    <div>
                        <button
                            type="button"
                            onClick={goBack}
                            className="ncls-ghost-btn"
                            style={{
                                marginTop: "15px",
                                padding: "8px 14px",
                                cursor: "pointer",
                                border: "1px solid rgba(210, 200, 180, 0.55)",
                                borderRadius: "6px",
                                background: "linear-gradient(165deg, #fffdf9, #f1eee5)",
                                boxShadow: "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)",
                                color: "#122941"
                            }}
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    if (!classroom) {
        return (
            <div
                style={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                        "radial-gradient(circle at 50% 0%, rgba(27, 67, 103, 0.2), transparent 35%), " +
                        "linear-gradient(145deg, #06101d, #091524)",
                    fontFamily: "'Vazirmatn', Tahoma, sans-serif"
                }}
            >
                <div
                    style={{
                        padding: "40px",
                        maxWidth: "400px",
                        width: "calc(100% - 40px)",
                        textAlign: "center",
                        background:
                            "linear-gradient(145deg, rgba(18, 37, 59, 0.85), rgba(8, 22, 37, 0.92))",
                        border: "1px solid rgba(255, 255, 255, 0.07)",
                        borderRadius: "17px",
                        boxShadow: "0 15px 40px rgba(0, 0, 0, 0.25)"
                    }}
                >
                    <h2 style={{ margin: "0 0 16px", color: "#f1eee5" }}>
                        کلاس پیدا نشد
                    </h2>

                    <button
                        type="button"
                        onClick={goBack}
                        className="ncls-ghost-btn"
                        style={{
                            padding: "8px 14px",
                            cursor: "pointer",
                            border: "1px solid rgba(210, 200, 180, 0.55)",
                            borderRadius: "6px",
                            background: "linear-gradient(165deg, #fffdf9, #f1eee5)",
                            boxShadow: "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)",
                            color: "#122941"
                        }}
                    >
                        بازگشت
                    </button>
                </div>
            </div>
        );
    }
    async function requestRejoin() {

        try {

            await api.post(
                `/classrooms/${id}/rejoin`,
                {},
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            setRejoinRequested(true);

        } catch (error) {

            console.error(
                "Failed to request rejoin:",
                error
            );

            alert(
                error.response?.data?.detail ||
                "Failed to send rejoin request."
            );
        }
    }

    const myDisplayName =
        onlineUsers.find(
            (user) => Number(user.id) === Number(currentUserId)
        )?.username || "You";

    const teacherDisplayName =
        onlineUsers.find((user) => user.role === "teacher")
            ?.username || "Teacher";

    const toolbarIconStyle = (isActive) => ({
        width: "36px",
        height: "36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        border: isActive
            ? "1px solid rgba(93, 157, 198, 0.35)"
            : "1px solid rgba(210, 200, 180, 0.55)",
        borderRadius: "9px",
        cursor: "pointer",
        background: isActive
            ? "linear-gradient(135deg, #245b82, #173e5e)"
            : "linear-gradient(165deg, #fffdf9, #f1eee5)",
        color: isActive ? "#f1eee5" : "#2c2416",
        boxShadow: isActive
            ? "0 6px 16px rgba(5, 25, 42, 0.35)"
            : "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)",
        flexShrink: 0
    });

    const memberActionStyle = (isActive) => ({
        width: "26px",
        height: "26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12px",
        border: "1px solid " + (isActive ? "#76a7c9" : "rgba(255, 255, 255, 0.16)"),
        borderRadius: "50%",
        cursor: "pointer",
        backgroundColor: isActive
            ? "rgba(118, 167, 201, 0.22)"
            : "rgba(255, 255, 255, 0.04)",
        color: isActive ? "#cfe3f0" : "#8b96a5",
        flexShrink: 0,
        padding: 0
    });

    const toolbarSeparator = (
        <div
            style={{
                width: "1px",
                height: "24px",
                backgroundColor: "rgba(255, 255, 255, 0.12)",
                flexShrink: 0
            }}
        />
    );

    if (loading) {
        return (
            <div
                style={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                        "radial-gradient(circle at 50% 0%, rgba(27, 67, 103, 0.2), transparent 35%), " +
                        "linear-gradient(145deg, #06101d, #091524)",
                    color: "#8b96a5",
                    fontFamily: "'Vazirmatn', Tahoma, sans-serif"
                }}
            >
                Loading classroom...
            </div>
        );
    }

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                background:
                    "radial-gradient(circle at 50% 0%, rgba(27, 67, 103, 0.2), transparent 35%), " +
                    "linear-gradient(145deg, #06101d, #091524)",
                color: "#f1eee5",
                fontFamily:
                    "'Vazirmatn', Tahoma, sans-serif"
            }}
        >
            {/* Embedded design-system rules. Not an external stylesheet —
                this stays inside Classroom.jsx per the current stage's
                constraints. :root variables are copied verbatim from
                studentDashboard.css so this page uses the exact same
                palette as the rest of the app. Handles states plain
                inline styles can't express (hover/focus/disabled) plus
                light responsive tweaks. !important is only used where a
                hover/focus rule needs to win over an inline style on the
                same property. */}
            <style>{`
                @import url("https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&family=Playfair+Display:wght@500;600&display=swap");

                :root {
                    --navy-deep: #06101d;
                    --navy: #091524;
                    --navy-card: #0d1e31;
                    --navy-light: #122941;
                    --blue: #245b82;
                    --blue-light: #76a7c9;
                    --cream: #f1eee5;
                    --cream-soft: #d9d7d0;
                    --gray: #8b96a5;
                    --gray-dark: #586678;
                    --border: rgba(255, 255, 255, 0.07);
                    --danger: #c87979;
                }
                .ncls-icon-btn {
                    transition: background .15s ease,
                        border-color .15s ease, transform .05s ease,
                        box-shadow .15s ease;
                }
                .ncls-icon-btn:hover:not(:disabled) {
                    border-color: var(--blue-light) !important;
                    background: linear-gradient(165deg, #eef6fb, #dcebf5) !important;
                    box-shadow: 0 2px 4px rgba(20, 15, 5, 0.08),
                        0 6px 14px rgba(20, 15, 5, 0.14) !important;
                }
                .ncls-icon-btn:active:not(:disabled) {
                    transform: scale(0.94);
                }
                .ncls-icon-btn:disabled {
                    opacity: 0.45;
                    cursor: not-allowed !important;
                }
                .ncls-ghost-btn {
                    transition: background .15s ease,
                        border-color .15s ease, color .15s ease,
                        box-shadow .15s ease;
                }
                .ncls-ghost-btn:hover {
                    background: linear-gradient(165deg, #eef6fb, #dcebf5) !important;
                    border-color: var(--blue-light) !important;
                    box-shadow: 0 2px 4px rgba(20, 15, 5, 0.08),
                        0 6px 14px rgba(20, 15, 5, 0.14);
                }
                .ncls-primary-btn {
                    transition: filter .15s ease,
                        transform .05s ease, box-shadow .15s ease;
                }
                .ncls-primary-btn:hover {
                    filter: brightness(1.1);
                }
                .ncls-primary-btn:active {
                    transform: scale(0.97);
                }
                .ncls-member-action-btn {
                    transition: border-color .15s ease,
                        background-color .15s ease;
                }
                .ncls-member-action-btn:hover {
                    border-color: var(--blue-light) !important;
                }
                .ncls-swatch {
                    transition: transform .1s ease;
                }
                .ncls-swatch:hover {
                    transform: scale(1.12);
                }
                .ncls-chat-input:focus {
                    outline: none;
                    border-color: var(--blue-light) !important;
                    box-shadow: 0 0 0 3px rgba(118, 167, 201, 0.18);
                }
                .ncls-member-row:hover {
                    background-color: rgba(255, 255, 255, 0.035);
                }
                .ncls-toolbar button:not(:disabled):hover {
                    border-color: var(--blue-light) !important;
                    background: linear-gradient(165deg, #eef6fb, #dcebf5) !important;
                    box-shadow: 0 2px 4px rgba(20, 15, 5, 0.08),
                        0 6px 14px rgba(20, 15, 5, 0.14) !important;
                }
                .ncls-toolbar button:not(:disabled):active {
                    transform: scale(0.95);
                }
                .ncls-members-list button:not(:disabled):hover {
                    border-color: var(--blue-light) !important;
                    background-color: rgba(118, 167, 201, 0.16) !important;
                }
                .ncls-members-list
                    button[title^="Kick"]:not(:disabled):hover {
                    border-color: var(--danger) !important;
                    background-color: rgba(150, 58, 58, 0.16) !important;
                }
                @media (max-width: 900px) {
                    .ncls-sidebar {
                        width: 240px !important;
                    }
                }
                @media (max-width: 680px) {
                    .ncls-sidebar {
                        width: 190px !important;
                    }
                    .ncls-brandbar-text {
                        display: none;
                    }
                }
            `}</style>

            {/* ===================== BRAND BAR ===================== */}
            <div
                className="ncls-brandbar"
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "5px 20px",
                    backgroundColor: "rgba(6, 16, 29, 0.72)",
                    backdropFilter: "blur(18px)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0
                }}
            >
                <span
                    className="ncls-brandbar-text"
                    style={{
                        fontFamily: "'Playfair Display', Georgia, serif",
                        direction: "ltr",
                        fontSize: "0.85em",
                        fontWeight: 500,
                        letterSpacing: "0.02em",
                        color: "var(--cream)"
                    }}
                >
                    Nissinai Class
                </span>
            </div>

            {/* ===================== HEADER ===================== */}
            <div
                className="ncls-header"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "10px 20px",
                    backgroundColor: "rgba(6, 16, 29, 0.72)",
                    backdropFilter: "blur(18px)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0
                }}
            >
                <button
                    type="button"
                    onClick={goBack}
                    title="بازگشت"
                    className="ncls-icon-btn"
                    style={{
                        width: "36px",
                        height: "36px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        border: "1px solid rgba(210, 200, 180, 0.55)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        background: "linear-gradient(165deg, #fffdf9, #f1eee5)",
                        boxShadow: "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)",
                        color: "#122941",
                        flexShrink: 0
                    }}
                >
                    ←
                </button>

                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "center"
                    }}
                >
                    <div
                        style={{
                            fontSize: "1.15em",
                            fontWeight: 600,
                            color: "var(--cream)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                        }}
                    >
                        {classroom.title}
                    </div>
                    <div
                        style={{
                            fontSize: "0.8em",
                            color: "var(--gray)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                        }}
                    >
                        {classroom.description ||
                            "No description"}
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "11px",
                        whiteSpace: "nowrap",
                        flexShrink: 0
                    }}
                >
                    <div
                        style={{
                            width: "39px",
                            height: "39px",
                            borderRadius: "12px",
                            background:
                                "linear-gradient(145deg, #245b82, #173e5e)",
                            color: "var(--cream)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.85em",
                            fontWeight: 600,
                            flexShrink: 0
                        }}
                    >
                        {accountName
                            ? accountName.charAt(0).toUpperCase()
                            : "؟"}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "1px",
                            lineHeight: 1.25
                        }}
                    >
                        <span
                            style={{
                                fontSize: "0.65em",
                                color: "var(--gray-dark)"
                            }}
                        >
                            حساب کاربری
                        </span>
                        <span
                            style={{
                                fontSize: "0.85em",
                                fontWeight: 500,
                                color: "var(--cream-soft)"
                            }}
                        >
                            {accountName}
                        </span>
                    </div>
                </div>
            </div>

            {/* ================= CLASS CODE ROW =================== */}
            {classroom.invite_code && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "6px 20px",
                        fontSize: "0.85em",
                        color: "var(--gray)",
                        backgroundColor: "rgba(255, 255, 255, 0.025)",
                        borderBottom: "1px solid var(--border)",
                        flexShrink: 0
                    }}
                >
                    <span>
                        <span>کد کلاس:</span>{" "}
                        <code
                            dir="ltr"
                            style={{
                                padding: "2px 10px",
                                backgroundColor: "#fff",
                                border: "1px solid #e2e2e2",
                                borderRadius: "999px",
                                fontWeight: 700,
                                color: "#173e5e",
                                unicodeBidi: "isolate"
                            }}
                        >
                            {classroom.invite_code}
                        </code>
                    </span>

                    {accountRole === "teacher" && (
                        <button
                            type="button"
                            onClick={copyInviteCode}
                            title="کپی کردن کد کلاس"
                            className="ncls-ghost-btn"
                            style={{
                                padding: "3px 10px",
                                fontSize: "0.9em",
                                cursor: "pointer",
                                border: "1px solid rgba(210, 200, 180, 0.55)",
                                borderRadius: "5px",
                                background: "linear-gradient(165deg, #fffdf9, #f1eee5)",
                                boxShadow: "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)",
                                color: "#122941"
                            }}
                        >
                            {copied ? "✓کپی شد" : "⧉ کپی"}
                        </button>
                    )}
                </div>
            )}

            {/* ===================== TOOLBAR ===================== */}
            <div
                className="ncls-toolbar"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 20px",
                    backgroundColor: "rgba(13, 30, 49, 0.75)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                    flexWrap: "wrap",
                    rowGap: "8px"
                }}
            >
                {accountRole === "teacher" && (
                <div style={{ display: "flex", gap: "6px" }}>
                    <button
                        type="button"
                        title="تخته سفید"
                        onClick={() =>
                            changeBoardMode("whiteboard")
                        }
                        style={toolbarIconStyle(
                            boardMode === "whiteboard"
                        )}
                    >
                        <Presentation size={20} strokeWidth={2} />
                    </button>

                    {accountRole === "teacher" && (
                        <button
                            type="button"
                            title="فایل"
                            onClick={() =>
                                changeBoardMode("file")
                            }
                            style={toolbarIconStyle(
                                boardMode === "file"
                            )}
                        >
                            <File size={20} strokeWidth={2} />
                        </button>
                    )}

                    {accountRole === "teacher" && (
                        <button
                            type="button"
                            title="دوربین"
                            onClick={() =>
                                changeBoardMode("camera")
                            }
                            style={toolbarIconStyle(
                                boardMode === "camera"
                            )}
                        >
                            <Camera size={20} strokeWidth={2} />
                        </button>
                    )}
                </div>
            )}
                {canSpeak && toolbarSeparator}
                {canSpeak && (
                    <button
                        type="button"
                        title={isMicOn ? "میکروفن وصل است - برای قطع کردن کلیک کنید" : "میکروفن قطع است - برای اتصال کلیک کنید"}
                        onClick={toggleMic}
                        style={{
                            ...toolbarIconStyle(isMicOn),
                            backgroundColor: isMicOn
                                ? "#43a047"
                                : "#f5f5f5",
                            borderColor: isMicOn
                                ? "#43a047"
                                : "#ddd",
                            color: isMicOn ? "#fff" : "#122941"
                        }}
                    >
                        {isMicOn ? (
                    <Mic size={20} strokeWidth={2} />
                ) : (
                    <MicOff size={20} strokeWidth={2} />
                )}
                    </button>
                )}

                {accountRole !== "teacher" && toolbarSeparator}
                {accountRole !== "teacher" && (
                    <button
                        type="button"
                        title={
                            raisedHands[currentUserId]
                                ? "پایین آوردن دست"
                                : "بالا بردن دست"
                        }
                        onClick={toggleRaiseHand}
                        style={{
                            ...toolbarIconStyle(
                                Boolean(raisedHands[currentUserId])
                            ),
                            backgroundColor: raisedHands[
                                currentUserId
                            ]
                                ? "#fb8c00"
                                : "#f5f5f5",
                            borderColor: raisedHands[
                                currentUserId
                            ]
                                ? "#fb8c00"
                                : "#ddd"
                        }}
                        >
                            <Hand size={20} strokeWidth={2} />
                        </button>
                )}

                {canDraw && toolbarSeparator}
                {canDraw && (
                    <div style={{ display: "flex", gap: "6px" }}>
                        <button
                            type="button"
                            title="حالت موس"
                            onClick={() => setInputMode("mouse")}
                            style={toolbarIconStyle(
                                inputMode === "mouse"
                            )}
                        >
                            <Mouse size={20} strokeWidth={2} />
                        </button>

                        <button
                            type="button"
                            title="حالت هوش مصنوعی"
                            onClick={() => setInputMode("ai")}
                            style={toolbarIconStyle(inputMode === "ai")}
                        >
                            <Bot size={20} strokeWidth={2} />
                        </button>
                    </div>
                )}

                {canDraw && toolbarSeparator}
                {canDraw && (
                    <div style={{ display: "flex", gap: "6px" }}>
                        <button
                            type="button"
                            title="قلم"
                            onClick={() => setTool("pen")}
                            style={toolbarIconStyle(tool === "pen")}
                        >
                            <Pencil size={20} strokeWidth={2} />
                        </button>
                        <button
                            type="button"
                            title="پاک کن"
                            onClick={() => setTool("eraser")}
                            style={toolbarIconStyle(
                                tool === "eraser"
                            )}
                        >
                            <Eraser size={20} strokeWidth={2} />
                        </button>
                    </div>
                )}

                {canDraw && tool === "pen" && toolbarSeparator}
                {canDraw && tool === "pen" && (
                    <div
                        title="اندازه قلم"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        <input
                            type="range"
                            min="1"
                            max="10"
                            value={penSize}
                            onChange={(event) =>
                                setPenSize(
                                    Number(event.target.value)
                                )
                            }
                            style={{ width: "70px" }}
                        />
                        <span
                            style={{
                                fontSize: "0.8em",
                                color: "var(--gray)",
                                minWidth: "26px"
                            }}
                        >
                            {penSize}px
                        </span>
                    </div>
                )}

                {canDraw && tool === "eraser" && toolbarSeparator}
                {canDraw && tool === "eraser" && (
                    <div
                        title="اندازه پاکن"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        <input
                            type="range"
                            min="10"
                            max="50"
                            value={eraserSize}
                            onChange={(event) =>
                                setEraserSize(
                                    Number(event.target.value)
                                )
                            }
                            style={{ width: "70px" }}
                        />
                        <span
                            style={{
                                fontSize: "0.8em",
                                color: "var(--gray)",
                                minWidth: "26px"
                            }}
                        >
                            {eraserSize}px
                        </span>
                    </div>
                )}

                {canDraw && tool === "pen" && toolbarSeparator}
                {canDraw && tool === "pen" && (
                    <div
                        title="Color"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        <button
                            type="button"
                            title="مشکی"
                            onClick={() =>
                                setSelectedColor("#000000")
                            }
                            style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                border:
                                    selectedColor === "#000000"
                                        ? "3px solid #f1eee5"
                                        : "1px solid rgba(255, 255, 255, 0.35)",
                                backgroundColor: "#000000",
                                cursor: "pointer",
                                padding: 0
                            }}
                        />
                        <button
                            type="button"
                            title="قرمز"
                            onClick={() =>
                                setSelectedColor("#e53935")
                            }
                            style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                border:
                                    selectedColor === "#e53935"
                                        ? "3px solid #f1eee5"
                                        : "1px solid rgba(255, 255, 255, 0.35)",
                                backgroundColor: "#e53935",
                                cursor: "pointer",
                                padding: 0
                            }}
                        />
                        <button
                            type="button"
                            title="آبی"
                            onClick={() =>
                                setSelectedColor("#1e88e5")
                            }
                            style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                border:
                                    selectedColor === "#1e88e5"
                                        ? "3px solid #f1eee5"
                                        : "1px solid rgba(255, 255, 255, 0.35)",
                                backgroundColor: "#1e88e5",
                                cursor: "pointer",
                                padding: 0
                            }}
                        />
                        <button
                            type="button"
                            title="سبز"
                            onClick={() =>
                                setSelectedColor("#43a047")
                            }
                            style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                border:
                                    selectedColor === "#43a047"
                                        ? "3px solid #f1eee5"
                                        : "1px solid rgba(255, 255, 255, 0.35)",
                                backgroundColor: "#43a047",
                                cursor: "pointer",
                                padding: 0
                            }}
                        />
                    </div>
                )}

                {accountRole === "teacher" && toolbarSeparator}
                {accountRole === "teacher" && (
                <button
                    type="button"
                    title="پاک کردن تخته"
                    onClick={clearWhiteboard}
                    style={toolbarIconStyle(false)}
                >
                    <Trash2 size={20} strokeWidth={2} />
                </button>
                )}

                {accountRole === "teacher" &&
                    boardMode === "file" &&
                    toolbarSeparator}
                {accountRole === "teacher" &&
                    boardMode === "file" && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handleBoardFileChange}
                                style={{ display: "none" }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                title="انتخاب فایل"
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "6px 12px",
                                    fontSize: "0.85em",
                                    cursor: "pointer",
                                    border: "1px solid rgba(210, 200, 180, 0.55)",
                                    borderRadius: "9px",
                                    background: "linear-gradient(165deg, #fffdf9, #f1eee5)",
                                    color: "#2c2416",
                                    boxShadow: "0 1px 2px rgba(20, 15, 5, 0.06), 0 4px 10px rgba(20, 15, 5, 0.1)"
                                }}
                            >
                                <File size={16} strokeWidth={2} />
                                انتخاب فایل
                            </button>
                            <span
                                style={{
                                    fontSize: "0.8em",
                                    color: "var(--cream-soft)",
                                    maxWidth: "160px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                {boardFile?.name || "فایلی انتخاب نشده"}
                            </span>
                        </>
                    )}

                {canDraw &&
                    boardMode === "file" &&
                    boardFile?.dataUrl?.startsWith("data:application/pdf") &&
                    toolbarSeparator}
                {canDraw &&
                    boardMode === "file" &&
                    boardFile?.dataUrl?.startsWith("data:application/pdf") && (
                        <button
                            type="button"
                            title={
                                pdfInteractive
                                    ? "در حال تعامل با پی‌دی‌اف — برای رسم روی تخته کلیک کنید"
                                    : "در حال رسم روی تخته — برای تعامل با پی‌دی‌اف کلیک کنید"
                            }
                            onClick={() =>
                                setPdfInteractive((prev) => !prev)
                            }
                            style={toolbarIconStyle(pdfInteractive)}
                        >
                            {pdfInteractive ? (
                                <BookOpen size={20} strokeWidth={2} />
                            ) : (
                                <PenTool size={20} strokeWidth={2} />
                            )}
                        </button>
                    )}
            </div>

            {/* =================== MAIN WORKSPACE =================== */}
            <div
                className="ncls-workspace"
                style={{
                    flex: 1,
                    display: "flex",
                    gap: "16px",
                    overflow: "hidden",
                    minHeight: 0,
                    margin: "12px",
                    padding: "16px",
                    border: "1px solid var(--border)",
                    borderRadius: "18px",
                    boxShadow: "0 15px 40px rgba(0, 0, 0, 0.25)",
                    background: "linear-gradient(160deg, #0d2440, #081a30)"
                }}
            >
                {/* ------------------- BLACKBOARD ------------------- */}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        position: "relative",
                        backgroundColor: "#fff",
                        borderRadius: "12px",
                        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.35)",
                        overflow: "hidden"
                    }}
                >
                    {boardMode === "file" && (
                        <>
                            {boardFile ? (
                                boardFile.dataUrl.startsWith("data:application/pdf") ? (
                                    <iframe
                                        src={pdfObjectUrl || undefined}
                                        title={boardFile.name || "Shared PDF"}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: "100%",
                                            border: "none",
                                            backgroundColor: "#fff"
                                        }}
                                    />
                                ) : (
                                    <img
                                        src={boardFile.dataUrl}
                                        alt={
                                            boardFile.name ||
                                            "Shared file"
                                        }
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                            backgroundColor: "#fff"
                                        }}
                                    />
                                )
                            ) : (
                                <div
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        height: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "#888"
                                    }}
                                >
                                    {accountRole === "teacher"
                                        ? "فایلی جهت نمایش در اینجا انتخاب کنید"
                                        : "...برای دریافت فایل کمی صبر کنید"}
                                </div>
                            )}
                        </>
                    )}
                    {boardMode === "camera" && (
                        <>
                            {accountRole === "teacher" ? (
                                <>
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                            backgroundColor: "#000",
                                            transform: "scaleX(-1)"
                                        }}
                                    />
                                    <div
                                        style={{
                                            position: "absolute",
                                            bottom: "8px",
                                            left: "8px",
                                            padding: "3px 10px",
                                            borderRadius: "4px",
                                            backgroundColor:
                                                "rgba(0,0,0,0.6)",
                                            color: "#fff",
                                            fontSize: "0.85em",
                                            pointerEvents: "none"
                                        }}
                                    >
                                        {myDisplayName}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <video
                                        ref={remoteVideoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                            backgroundColor: "#000",
                                            transform: "scaleX(-1)"
                                        }}
                                    />
                                    <div
                                        style={{
                                            position: "absolute",
                                            bottom: "8px",
                                            left: "8px",
                                            padding: "3px 10px",
                                            borderRadius: "4px",
                                            backgroundColor:
                                                "rgba(0,0,0,0.6)",
                                            color: "#fff",
                                            fontSize: "0.85em",
                                            pointerEvents: "none"
                                        }}
                                    >
                                        {teacherDisplayName}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                    {Object.entries(remoteAudioStreams).map(
                        ([userId, stream]) => (
                            <audio
                                key={userId}
                                autoPlay
                                ref={(el) => {
                                    if (
                                        el &&
                                        el.srcObject !== stream
                                    ) {
                                        el.srcObject = stream;
                                    }
                                }}
                            />
                        )
                    )}
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            display: "block",
                            cursor: canDraw
                                ? "crosshair"
                                : "default",
                            touchAction: "none",
                            pointerEvents:
                                canDraw &&
                                !(
                                    boardMode === "file" &&
                                    pdfInteractive &&
                                    boardFile?.dataUrl?.startsWith(
                                        "data:application/pdf"
                                    )
                                )
                                    ? "auto"
                                    : "none",
                            boxSizing: "border-box",
                            zIndex: 2
                        }}
                        onPointerDown={startDrawing}
                        onPointerMove={draw}
                        onPointerUp={stopDrawing}
                        onPointerCancel={stopDrawing}
                    />
                    {inputMode === "ai" && (
                        <div
                            ref={aiCursorDotRef}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                backgroundColor: "rgba(25, 118, 210, 0.85)",
                                border: "2px solid #fff",
                                boxShadow: "0 0 4px rgba(0, 0, 0, 0.4)",
                                pointerEvents: "none",
                                display: "none",
                                zIndex: 3
                            }}
                        />
                    )}
                    {inputMode === "ai" && (
                        <div
                            style={{
                                position: "absolute",
                                bottom: "8px",
                                right: "8px",
                                width: "160px",
                                borderRadius: "6px",
                                overflow: "hidden",
                                border: "2px solid #245b82",
                                backgroundColor: "#000",
                                zIndex: 3
                            }}
                        >
                            <video
                                ref={aiVideoRef}
                                autoPlay
                                playsInline
                                muted
                                style={{
                                    width: "100%",
                                    height: "120px",
                                    objectFit: "cover",
                                    display: "block",
                                    transform: "scaleX(-1)"
                                }}
                            />
                            <div
                                style={{
                                    padding: "4px 6px",
                                    fontSize: "0.75em",
                                    color: "#fff",
                                    backgroundColor: "rgba(0,0,0,0.7)"
                                }}
                            >
                                {aiStatus === "loading" &&
                                    "Starting AI..."}
                                {aiStatus === "error" && (
                                    <span
                                        style={{
                                            color: "#ff8a80"
                                        }}
                                    >
                                        {aiErrorMessage ||
                                            "AI mode failed to start"}
                                    </span>
                                )}
                                {aiStatus === "ready" && (
                                    <>
                                        {aiGesture === "DRAW" &&
                                            "☝️ Draw"}
                                        {aiGesture === "STOP" &&
                                            "✌️ Stop"}
                                        {aiGesture === "ERASE" &&
                                            "✊ Erase"}
                                        {aiGesture === "NONE" &&
                                            "No hand detected"}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* -------------------- SIDEBAR -------------------- */}
                <div
                    className="ncls-sidebar"
                    style={{
                        width: "300px",
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        color: "var(--cream-soft)"
                    }}
                >
                    {/* Online Users panel */}
                    <div
                        style={{
                            flex: "0 1 45%",
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                            minHeight: 0,
                            background:
                                "linear-gradient(145deg, rgba(18, 37, 59, 0.97), rgba(8, 22, 37, 0.99))",
                            border: "1px solid var(--border)",
                            borderRadius: "12px",
                            boxShadow: "0 8px 22px rgba(0, 0, 0, 0.28)"
                        }}
                    >
                        <div
                            style={{
                                padding: "10px 14px",
                                fontWeight: 600,
                                fontSize: "0.85em",
                                color: "var(--cream)",
                                borderBottom: "1px solid var(--border)",
                                flexShrink: 0
                            }}
                        >
                            کاربران آنلاین
                        </div>

                        <ul
                            className="ncls-members-list"
                            style={{
                                listStyle: "none",
                                margin: 0,
                                padding: "4px 10px",
                                overflowY: "auto",
                                flex: 1,
                                minHeight: 0
                            }}
                        >
                            {members.map((member) => {

                                const userId =
                                    member.user_id ||
                                    member.user?.id ||
                                    member.id;

                                const username =
                                    member.username ||
                                    member.user?.username ||
                                    "Unknown user";

                                const role =
                                    member.role ||
                                    member.user?.role ||
                                    "student";

                                const isOnline = onlineUsers.some(
                                    (user) =>
                                        Number(user.id) ===
                                        Number(userId)
                                );

                                const hasPermission =
                                    memberPermissions[userId] ||
                                    false;

                                return (
                                    <li
                                        key={userId}
                                        className="ncls-member-row"
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "6px 2px",
                                            borderBottom:
                                                "1px solid var(--border)",
                                            fontSize: "0.85em"
                                        }}
                                    >
<span
                                            title={
                                                isOnline
                                                    ? "آنلاین"
                                                    : "آفلاین"
                                            }
                                        >
                                            {isOnline
                                                ? "🟢"
                                                : "⚪️"}
                                        </span>

                                        <span
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: "hidden",
                                                textOverflow:
                                                    "ellipsis",
                                                whiteSpace:
                                                    "nowrap"
                                            }}
                                        >
                                            {username}
                                            {role === "teacher" && (
                                                <GraduationCap
                                                    size={16}
                                                    strokeWidth={2}
                                                    style={{
                                                        marginLeft: 4,
                                                        verticalAlign: "middle"
                                                    }}
                                                />
                                            )}
                                            {raisedHands[userId] && (
                                                <Hand
                                                    size={16}
                                                    strokeWidth={2}
                                                    style={{
                                                        marginLeft: 4,
                                                        verticalAlign: "middle"
                                                    }}
                                                />
                                            )}
                                        </span>

                                        {accountRole ===
                                            "teacher" &&
                                            role !== "teacher" && (
                                                <div
                                                    style={{
                                                        display:
                                                            "flex",
                                                        gap: "4px",
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        title={
                                                            micPermissions[
                                                                userId
                                                            ]
                                                                ? "قطع دسترسی به میکروفن"
                                                                : "دسترسی به میکروفن"
                                                        }
                                                        onClick={() =>
                                                            changeMicPermission(
                                                                userId,
                                                                !(
                                                                    micPermissions[
                                                                        userId
                                                                    ] ||
                                                                    false
                                                                )
                                                            )
                                                        }
                                                        style={memberActionStyle(
                                                            Boolean(
                                                                micPermissions[
                                                                    userId
                                                                ]
                                                            )
                                                        )}
                                                    >
                                                    <Mic size={20} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={
                                                            hasPermission
                                                                ? "قطع دسترسی به تخته"
                                                                : "اجازه دسترسی به تخته"
                                                        }
                                                        onClick={() =>
                                                            changeWhiteboardPermission(
                                                                userId,
                                                                !hasPermission
                                                            )
                                                        }
                                                        style={memberActionStyle(
                                                            hasPermission
                                                        )}
                                                    >
                                                    <Pencil size={20} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={
                                                            "اخراج " +
                                                            username
                                                        }
                                                        onClick={() =>
                                                            kickStudent(
                                                                userId,
                                                                username
                                                            )
                                                        }
                                                        style={{
                                                            ...memberActionStyle(
                                                                false
                                                            ),
                                                            color: "#c87979",
                                                            borderColor:
                                                                "rgba(200, 121, 121, 0.4)",
                                                            backgroundColor:
                                                                "rgba(150, 58, 58, 0.08)"
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            )}
                                    </li>
                                );
                            })}

                            {/* کاربران آنلاین که در members نیستند */}
                            {onlineUsers
                                .filter((onlineUser) => {

                                    return !members.some(
                                        (member) => {

                                            const memberUserId =
                                                member.user_id ||
                                                member.user?.id ||
                                                member.id;

                                            return (
                                                Number(
                                                    memberUserId
                                                ) ===
                                                Number(
                                                    onlineUser.id
                                                )
                                            );
                                        }
                                    );

                                })
                                .map((onlineUser) => (

                                    <li
                                        key={onlineUser.id}
                                        className="ncls-member-row"
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "6px 2px",
                                            borderBottom:
                                                "1px solid var(--border)",
                                            fontSize: "0.85em"
                                        }}
                                    >
                                <span title="Online">
                                            🟢
                                        </span>



                                        <span
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: "hidden",
                                                textOverflow:
                                                    "ellipsis",
                                                whiteSpace:
                                                    "nowrap"
                                            }}
                                        >
                                            {onlineUser.username}
                                            {onlineUser.role === "teacher" && (
                                                <GraduationCap
                                                    size={16}
                                                    strokeWidth={2}
                                                    style={{
                                                        marginLeft: 4,
                                                        verticalAlign: "middle"
                                                    }}
                                                />
                                            )}
                                            {raisedHands[onlineUser.id] && (
                                                <Hand
                                                    size={16}
                                                    strokeWidth={2}
                                                    style={{
                                                        marginLeft: 4,
                                                        verticalAlign: "middle"
                                                    }}
                                                />
                                            )}
                                        </span>

                                        {accountRole ===
                                            "teacher" &&
                                            onlineUser.role !==
                                                "teacher" && (
                                                <div
                                                    style={{
                                                        display:
                                                            "flex",
                                                        gap: "4px",
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        title={
                                                            micPermissions[
                                                                onlineUser.id
                                                            ]
                                                                ? "قطع دسترسی به میکروفن"
                                                                : "دسترسی به میکروفن"
                                                        }
                                                        onClick={() =>
                                                            changeMicPermission(
                                                                onlineUser.id,
                                                                !(
                                                                    micPermissions[
                                                                        onlineUser.id
                                                                    ] ||
                                                                    false
                                                                )
                                                            )
                                                        }
                                                        style={memberActionStyle(
                                                            Boolean(
                                                                micPermissions[
                                                                    onlineUser.id
                                                                ]
                                                            )
                                                        )}
                                                    >
                                                    <Mic size={20} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={
                                                            memberPermissions[
                                                                onlineUser
                                                                    .id
                                                            ]
                                                                ? "قطع دسترسی به تخته"
                                                                : "اجازه دسترسی به تخته"
                                                        }
                                                        onClick={() =>
                                                            changeWhiteboardPermission(
                                                                onlineUser.id,
                                                                !(
                                                                    memberPermissions[
                                                                        onlineUser
                                                                            .id
                                                                    ] ||
                                                                    false
                                                                )
                                                            )
                                                        }
                                                        style={memberActionStyle(
                                                            Boolean(
                                                                memberPermissions[
                                                                    onlineUser
                                                                        .id
                                                                ]
                                                            )
                                                        )}
                                                    >
                                                    <Pencil size={20} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={
                                                            "Kick " +
                                                            onlineUser.username
                                                        }
                                                        onClick={() =>
                                                            kickStudent(
                                                                onlineUser.id,
                                                                onlineUser.username
                                                            )
                                                        }
                                                        style={{
                                                            ...memberActionStyle(
                                                                false
                                                            ),
                                                            color: "#c87979",
                                                            borderColor:
                                                                "rgba(200, 121, 121, 0.4)",
                                                            backgroundColor:
                                                                "rgba(150, 58, 58, 0.08)"
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            )}
                                    </li>
                                ))}
                        </ul>
                    </div>

                    {/* Chat panel */}
                    <div
                        style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                            minHeight: 0,
                            background:
                                "linear-gradient(145deg, rgba(18, 37, 59, 0.97), rgba(8, 22, 37, 0.99))",
                            border: "1px solid var(--border)",
                            borderRadius: "12px",
                            boxShadow: "0 8px 22px rgba(0, 0, 0, 0.28)"
                        }}
                    >
                        <div
                            style={{
                                padding: "10px 14px",
                                fontWeight: 600,
                                fontSize: "0.85em",
                                color: "var(--cream)",
                                borderBottom: "1px solid var(--border)",
                                flexShrink: 0
                            }}
                        >
                            چت کلاس
                        </div>

                        <div
                            ref={chatContainerRef}
                            style={{
                                flex: 1,
                                minHeight: 0,
                                overflowY: "auto",
                                padding: "10px 12px"
                            }}
                        >
                            {chatMessages.map((msg, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: "block",
                                        width: "fit-content",
                                        marginBottom: "8px",
                                        padding: "6px 12px",
                                        borderRadius: "8px",
                                        background:
                                            msg.role === "teacher"
                                                ? "linear-gradient(135deg, #245b82, #173e5e)"
                                                : "rgba(255, 255, 255, 0.06)",
                                        color:
                                            msg.role === "teacher"
                                                ? "#f1eee5"
                                                : "var(--cream-soft)",
                                        maxWidth: "95%",
                                        wordBreak: "break-word"
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "baseline",
                                            gap: "6px",
                                            fontSize: "0.85em"
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontWeight: 800
                                            }}
                                        >
                                            {msg.sender}
                                        </span>
                                        {formatMessageTime(
                                            getMessageTimestamp(
                                                msg
                                            )
                                        ) && (
                                            <span
                                                style={{
                                                    opacity: 0.7,
                                                    fontSize:
                                                        "0.9em"
                                                }}
                                            >
                                                {formatMessageTime(
                                                    getMessageTimestamp(
                                                        msg
                                                    )
                                                )}
                                            </span>
                                        )}
                                    </div>
                                    <div>{msg.message}</div>
                                </div>
                            ))}
                        </div>

                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                padding: "8px 10px",
                                borderTop: "1px solid var(--border)",
                                flexShrink: 0
                            }}
                        >
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(event) =>
                                    setChatInput(
                                        event.target.value
                                    )
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        sendChatMessage();
                                    }
                                }}
                                placeholder="پیام "
                                className="ncls-chat-input"
                                style={{
                                    flex: 1,
                                    padding: "8px 10px",
                                    border: "1px solid rgba(255, 255, 255, 0.16)",
                                    borderRadius: "6px",
                                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                                    color: "var(--cream)",
                                    fontSize: "0.9em"
                                }}
                            />
                            <button
                                type="button"
                                onClick={sendChatMessage}
                                title="ارسال"
                                className="ncls-primary-btn"
                                style={{
                                    padding: "8px 14px",
                                    cursor: "pointer",
                                    border: "1px solid rgba(93, 157, 198, 0.35)",
                                    borderRadius: "6px",
                                    background:
                                        "linear-gradient(135deg, #245b82, #173e5e)",
                                    color: "#f1eee5"
                                }}
                            >
                                ➤
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}