package com.aliyun.tingwu.assistant.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Environment
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AudioRecorderManager(private val context: Context) {

    companion object {
        private const val TAG = "AudioRecorderManager"
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var mediaRecorder: MediaRecorder? = null
    private var isRecordingBackup = false

    /**
     * 启用蓝牙耳机 SCO 音频拾音通道
     * 解决戴着 AirPods / 蓝牙耳机开会时，手机错误录入裤兜杂音的痛点
     */
    fun startBluetoothSco() {
        try {
            if (audioManager.isBluetoothScoAvailableOffCall) {
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
                Log.d(TAG, "已激活蓝牙 SCO 麦克风录音通道")
            }
        } catch (e: Exception) {
            Log.e(TAG, "激活蓝牙 SCO 麦克风异常", e)
        }
    }

    /**
     * 关闭蓝牙 SCO
     */
    fun stopBluetoothSco() {
        try {
            if (audioManager.isBluetoothScoOn) {
                audioManager.isBluetoothScoOn = false
                audioManager.stopBluetoothSco()
                Log.d(TAG, "已关闭蓝牙 SCO 通道")
            }
        } catch (e: Exception) {
            Log.e(TAG, "停止蓝牙 SCO 异常", e)
        }
    }

    /**
     * 启动本地双重安全录音备份 (AAC / M4A)
     * 防灾设计：即便听悟云端因为断网或 WebSocket 中断，手机本地依然有一份完整的高清录音
     */
    fun startLocalBackupRecording(): String? {
        if (isRecordingBackup) return null

        try {
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_RECORDINGS)
                ?: context.filesDir
            if (!dir.exists()) dir.mkdirs()

            val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val audioFile = File(dir, "tingwu_backup_$timeStamp.m4a")

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128000)
                setAudioSamplingRate(44100)
                setOutputFile(audioFile.absolutePath)
                prepare()
                start()
            }

            mediaRecorder = recorder
            isRecordingBackup = true
            Log.d(TAG, "本地双录备份已启动: ${audioFile.absolutePath}")
            return audioFile.absolutePath
        } catch (e: Exception) {
            Log.e(TAG, "启动本地备份录音失败", e)
            return null
        }
    }

    /**
     * 停止本地备份录音
     */
    fun stopLocalBackupRecording() {
        if (!isRecordingBackup) return

        try {
            mediaRecorder?.apply {
                stop()
                reset()
                release()
            }
            Log.d(TAG, "本地双录备份已安全保存")
        } catch (e: Exception) {
            Log.e(TAG, "停止本地备份录音异常", e)
        } finally {
            mediaRecorder = null
            isRecordingBackup = false
        }
    }
}
