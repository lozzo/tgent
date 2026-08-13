#ifndef TGENT_CLIENT_H
#define TGENT_CLIENT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TGENT_CLIENT_ABI_VERSION 1u
typedef uint64_t tgent_handle_t;

typedef enum tgent_status_v1 {
  TGENT_STATUS_OK = 0,
  TGENT_STATUS_INVALID_ARGUMENT = 1,
  TGENT_STATUS_INVALID_HANDLE = 2,
  TGENT_STATUS_CLOSED = 3,
  TGENT_STATUS_INTERNAL = 4
} tgent_status_v1;

typedef struct tgent_buffer_v1 {
  tgent_handle_t buffer_handle;
  const uint8_t *data;
  size_t length;
} tgent_buffer_v1;

uint32_t tgent_client_abi_version(void);
tgent_status_v1 tgent_engine_create(tgent_handle_t *out_engine);
tgent_status_v1 tgent_engine_command(tgent_handle_t engine, const uint8_t *json, size_t length, tgent_buffer_v1 *out_response);
tgent_status_v1 tgent_engine_next_event(tgent_handle_t engine, uint32_t timeout_millis, tgent_buffer_v1 *out_event);
tgent_status_v1 tgent_engine_bridge_port(tgent_handle_t engine, uint16_t *out_port);
tgent_status_v1 tgent_engine_close(tgent_handle_t engine);
tgent_status_v1 tgent_buffer_free(tgent_handle_t buffer);

#ifdef __cplusplus
}
#endif
#endif
