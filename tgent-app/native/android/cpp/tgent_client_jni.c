#include <jni.h>
#include <stdint.h>
#include <stdio.h>
#include "tgent_client.h"

static int check(JNIEnv *env, tgent_status_v1 status) {
  if (status == TGENT_STATUS_OK) return 0;
  jclass cls = (*env)->FindClass(env, "java/lang/IllegalStateException");
  if (cls != NULL) { char msg[64]; snprintf(msg, sizeof(msg), "Tgent Go status %d", status); (*env)->ThrowNew(env, cls, msg); }
  return -1;
}

static jbyteArray copy_buffer(JNIEnv *env, tgent_buffer_v1 *buffer) {
  jbyteArray out = (*env)->NewByteArray(env, (jsize)buffer->length);
  if (out != NULL && buffer->length > 0) (*env)->SetByteArrayRegion(env, out, 0, (jsize)buffer->length, (const jbyte *)buffer->data);
  if (buffer->buffer_handle != 0) check(env, tgent_buffer_free(buffer->buffer_handle));
  return out;
}

JNIEXPORT jint JNICALL Java_com_tgent_app_goclient_GoClientNative_abiVersion(JNIEnv *env, jobject self) { (void)env;(void)self;return (jint)tgent_client_abi_version(); }
JNIEXPORT jlong JNICALL Java_com_tgent_app_goclient_GoClientNative_create(JNIEnv *env, jobject self) { (void)self;tgent_handle_t h=0;if(check(env,tgent_engine_create(&h)))return 0;return (jlong)h; }
JNIEXPORT jint JNICALL Java_com_tgent_app_goclient_GoClientNative_bridgePort(JNIEnv *env,jobject self,jlong engine){(void)self;uint16_t port=0;if(check(env,tgent_engine_bridge_port((tgent_handle_t)engine,&port)))return 0;return (jint)port;}
JNIEXPORT jbyteArray JNICALL Java_com_tgent_app_goclient_GoClientNative_command(JNIEnv *env,jobject self,jlong engine,jbyteArray payload){(void)self;if(payload==NULL){check(env,TGENT_STATUS_INVALID_ARGUMENT);return NULL;}jsize n=(*env)->GetArrayLength(env,payload);jbyte *p=(*env)->GetByteArrayElements(env,payload,NULL);tgent_buffer_v1 out={0};tgent_status_v1 status=tgent_engine_command((tgent_handle_t)engine,(const uint8_t*)p,(size_t)n,&out);(*env)->ReleaseByteArrayElements(env,payload,p,JNI_ABORT);if(check(env,status))return NULL;return copy_buffer(env,&out);}
JNIEXPORT jbyteArray JNICALL Java_com_tgent_app_goclient_GoClientNative_nextEvent(JNIEnv *env,jobject self,jlong engine,jint timeout){(void)self;tgent_buffer_v1 out={0};if(check(env,tgent_engine_next_event((tgent_handle_t)engine,(uint32_t)timeout,&out)))return NULL;return copy_buffer(env,&out);}
JNIEXPORT void JNICALL Java_com_tgent_app_goclient_GoClientNative_close(JNIEnv *env,jobject self,jlong engine){(void)self;check(env,tgent_engine_close((tgent_handle_t)engine));}
