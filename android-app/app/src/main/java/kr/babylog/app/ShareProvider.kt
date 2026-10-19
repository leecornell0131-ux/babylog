package kr.babylog.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

// 백업 파일을 다른 앱(내 파일, 드라이브, 카카오톡 등)으로 넘기기 위한 최소한의 파일 제공자
class ShareProvider : ContentProvider() {
    private fun file(uri: Uri): File {
        val name = uri.lastPathSegment ?: throw FileNotFoundException()
        val dir = File(context!!.cacheDir, "share")
        val f = File(dir, name)
        if (f.parentFile?.canonicalPath != dir.canonicalPath || !f.exists()) throw FileNotFoundException()
        return f
    }

    override fun onCreate() = true
    override fun getType(uri: Uri) = if (uri.lastPathSegment?.endsWith(".json") == true) "application/json" else "application/octet-stream"
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
        val f = file(uri)
        return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply { addRow(arrayOf<Any>(f.name, f.length())) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
}
