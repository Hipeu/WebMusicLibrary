import {
  ApiResponse,
  DeepPartial,
  DeepReadonly,
  Dictionary,
  If,
  IsEqual,
  Mutable,
  Nullable,
  PaginatedResponse,
  PromiseType,
  RequireAtLeastOne,
  RequireExactlyOne,
  Result,
} from '../../src/types/core/base';
import { assertType } from './assert-type';

// ==========================================
// 1. 基础泛型接口测试 (Base Generic Interfaces)
// ==========================================

// Dictionary Test
const dict: Dictionary<number> = { a: 1, b: 2 };
assertType<IsEqual<(typeof dict)['a'], number>>();

// ApiResponse Test
type User = { id: number; name: string };
const response: ApiResponse<User> = { code: 0, message: 'OK', data: { id: 1, name: 'Alice' } };
assertType<IsEqual<typeof response.data, User>>();

// PaginatedResponse Test
const list: PaginatedResponse<string> = { list: ['a', 'b'], total: 2, page: 1, size: 10 };
assertType<IsEqual<(typeof list.list)[0], string>>();

// Result Test
function _testResult(result: Result<number, string>) {
  if (result.ok === true) {
    const _val: number = result.value;
  } else {
    const _err: string = result.error;
  }
}

// ==========================================
// 2. 类型组合和派生测试 (Type Composition & Derivation)
// ==========================================

// Nullable Test
let maybeString: Nullable<string>;
assertType<IsEqual<typeof maybeString, string | null | undefined>>();

// DeepPartial Test
interface Config {
  db: { host: string; port: number };
  cache: string[];
}
type PartialConfig = DeepPartial<Config>;
assertType<IsEqual<PartialConfig['db'], { host?: string; port?: number } | undefined>>();
assertType<IsEqual<PartialConfig['cache'], string[] | undefined>>();

// DeepReadonly Test
interface State {
  user: { name: string; age: number };
}
type ReadonlyState = DeepReadonly<State>;
assertType<IsEqual<ReadonlyState['user'], { readonly name: string; readonly age: number }>>();

// Mutable Test
interface ReadonlyUser {
  readonly id: number;
}
type WritableUser = Mutable<ReadonlyUser>;
assertType<IsEqual<WritableUser, { id: number }>>();

// ==========================================
// 3. 类型约束和条件类型测试 (Constraints & Conditional Types)
// ==========================================

// PromiseType Test
type AsyncResult = Promise<string>;
assertType<IsEqual<PromiseType<AsyncResult>, string>>();
assertType<IsEqual<PromiseType<number>, number>>();

// RequireAtLeastOne Test
interface Contact {
  email: string;
  phone: string;
  address: string;
}
type AtLeastOneContact = RequireAtLeastOne<Contact, 'email' | 'phone'>;
const _c1: AtLeastOneContact = { email: 'a@b.com', address: 'Home' };
const _c2: AtLeastOneContact = { phone: '123', address: 'Home' };
const _c3: AtLeastOneContact = { email: 'a@b.com', phone: '123', address: 'Home' };
// const c4: AtLeastOneContact = { address: "Home" }; // 报错，缺少 email 或 phone

// RequireExactlyOne Test
interface Identity {
  idCard: string;
  passport: string;
  name: string;
}
type OneIdentity = RequireExactlyOne<Identity, 'idCard' | 'passport'>;
const _i1: OneIdentity = { idCard: '111', name: 'Alice' };
const _i2: OneIdentity = { passport: '222', name: 'Bob' };
// const i3: OneIdentity = { idCard: "111", passport: "222", name: "Charlie" }; // 报错，只能有其一
// const i4: OneIdentity = { name: "Dave" }; // 报错，至少需要其一

// If Test
type ConditionResult1 = If<true, 'Yes', 'No'>;
type ConditionResult2 = If<false, 'Yes', 'No'>;
assertType<IsEqual<ConditionResult1, 'Yes'>>();
assertType<IsEqual<ConditionResult2, 'No'>>();

describe('core base types', () => {
  it('should keep compile-time assertions valid', () => {
    expect(true).toBe(true);
  });
});
