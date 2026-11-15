package com.butterflyeffect.reactor

import inc.reactor.sdk.android.ConnectionStatus
import inc.reactor.sdk.android.Reactor
import inc.reactor.sdk.android.ReactorException
import inc.reactor.sdk.android.ReactorOptions
import inc.reactor.sdk.android.VideoFrame
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentLinkedQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Thin bridge between Unity (C#, AndroidWorldStream) and the Reactor Android SDK.
 *
 * Unity cannot await Kotlin suspend functions or collect flows, so everything that
 * happens here is turned into a JSON event that Unity polls once per frame, and the
 * newest video frame is kept in a direct buffer that Unity copies into a texture.
 */
class ReactorBridge {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val events = ConcurrentLinkedQueue<String>()
    @Volatile private var reactor: Reactor? = null

    // Two frame buffers: the SDK's media thread writes `pending`, Unity reads `reading`.
    // They are swapped under the lock, so Unity never reads a buffer that is being written.
    private val frameLock = Any()
    private var pending: ByteBuffer? = null
    private var reading: ByteBuffer? = null
    private var pendingWidth = 0
    private var pendingHeight = 0
    private var pendingSerial = 0L
    private var readSerial = 0L
    @Volatile private var readWidth = 0
    @Volatile private var readHeight = 0

    fun connect(jwt: String, model: String) {
        scope.launch {
            try {
                emit(JSONObject().put("kind", "status").put("status", "connecting"))
                val client = Reactor(ReactorOptions(jwt = jwt), Dispatchers.Default)
                reactor = client

                // "ready" is announced below, once the video handler is in place.
                launch { client.status.collect { if (it != ConnectionStatus.READY) emitStatus(it) } }
                launch {
                    client.messages.collect { message ->
                        val data = message["data"]
                        emit(
                            JSONObject()
                                .put("kind", "message")
                                .put("type", message["type"]?.toString() ?: "")
                                .put("data", if (data == null) "{}" else JSONObject.wrap(data).toString())
                        )
                    }
                }
                launch { client.errors.collect { emitError(it) } }

                client.connect(model)
                client.status.first { it == ConnectionStatus.READY }
                attachVideo(client)
                emitStatus(ConnectionStatus.READY)
            } catch (error: Throwable) {
                emitError(error)
                emit(JSONObject().put("kind", "status").put("status", "disconnected"))
            }
        }
    }

    private suspend fun attachVideo(client: Reactor) {
        var lastError: Throwable? = null
        repeat(20) {
            try {
                client.track("main_video").onFrame { frame: VideoFrame -> store(frame) }
                return
            } catch (error: ReactorException) {
                lastError = error // tracks are not declared yet
                delay(250)
            }
        }
        throw lastError ?: IllegalStateException("main_video track never appeared")
    }

    private fun store(frame: VideoFrame) {
        val size = frame.width * frame.height * 4
        synchronized(frameLock) {
            var target = pending
            if (target == null || target.capacity() != size) {
                target = ByteBuffer.allocateDirect(size)
                pending = target
            }
            target.clear()
            target.put(frame.pixels)
            pendingWidth = frame.width
            pendingHeight = frame.height
            pendingSerial++
        }
    }

    /** The newest frame as BGRA, top row first, or null when nothing new arrived since the last call. */
    fun readFrame(): ByteBuffer? {
        synchronized(frameLock) {
            if (pendingSerial == readSerial || pending == null) return null
            val fresh = pending
            pending = reading
            reading = fresh
            readSerial = pendingSerial
            readWidth = pendingWidth
            readHeight = pendingHeight
            return fresh
        }
    }

    fun frameWidth(): Int = readWidth

    fun frameHeight(): Int = readHeight

    /** Sends a model command. The outcome comes back as a "reply" event carrying the same id. */
    fun sendCommand(id: Int, name: String, argsJson: String) {
        scope.launch {
            val result = JSONObject().put("kind", "reply").put("id", id).put("command", name)
            try {
                val client = reactor ?: throw IllegalStateException("not connected")
                val reply = client.sendCommand(name, argsJson)
                result.put("ok", true).put("type", reply.type ?: "")
            } catch (error: Throwable) {
                val code = (error as? ReactorException)?.let { it.commandCode ?: it.code } ?: ""
                result.put("ok", false).put("code", code).put("text", error.message ?: error.toString())
            }
            emit(result)
        }
    }

    /** Ends the session (which stops billing) and releases the client. */
    fun disconnect() {
        val client = reactor ?: return
        reactor = null
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancelChildren()
        scope.launch {
            runCatching { client.disconnect() }
            runCatching { client.close() }
            emit(JSONObject().put("kind", "status").put("status", "disconnected"))
        }
    }

    /** One queued event as JSON, or null when the queue is empty. */
    fun pollEvent(): String? = events.poll()

    private fun emitStatus(status: ConnectionStatus) {
        emit(JSONObject().put("kind", "status").put("status", status.name.lowercase()))
    }

    private fun emitError(error: Throwable) {
        val code = (error as? ReactorException)?.code ?: ""
        emit(JSONObject().put("kind", "error").put("code", code).put("text", error.message ?: error.toString()))
    }

    private fun emit(event: JSONObject) {
        events.add(event.toString())
    }
}
