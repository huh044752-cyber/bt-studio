#include <algorithm>
#include "core/template/safe_refcount.h"
#include "core/mal/fz_mal_impl.h"
#include "core/mal/fz_marg_base_impl.h"

#ifndef ENLARGE_MULTIPLE
#define ENLARGE_MULTIPLE 2
#endif

inline char *new_str(const char *_str, int _const_size = -1)
{
    const char *source = (_str != nullptr) ? _str : "";
    size_t len = 0;
    len = strlen(source);
    char *n_str = nullptr;
    if (_const_size < 0)
    {
        n_str = new char[len + 1];
        memcpy(n_str, source, len + 1);
    }
    else
    {
        n_str = new char[_const_size];
        n_str[_const_size - 1] = 0;

        if (len + 1 >= _const_size)
        {
            memcpy(n_str, source, _const_size - 1);
        }
        else
        {
            memcpy(n_str, source, len + 1);
        }
    }

    return n_str;
}

struct FZMargBaseImplPrivate
{
    SafeRefCount ref_count;
    char *argument_name = nullptr;
    FZMARGType marg_type = FZMARGType::FZ_MARGTYPE_INVALID;

    union
    {
        FZBOOL bool_;
        FZIntegerType int_;
        FZRealType float_;
        FZEntityIDType id_;
        FZDMGRC dmgrc_;
        char *string_;
        void *pointer_;
        int64_t space_holder_;
    };
    FZMargBaseData *user_define_data = nullptr;
    ~FZMargBaseImplPrivate();

    static FZMargBaseImplPrivate *New(const char *_name, FZBOOL _value);
    static FZMargBaseImplPrivate *New(const char *_name, FZIntegerType _value);
    static FZMargBaseImplPrivate *New(const char *_name, FZRealType _value, FZMARGType _type);
    static FZMargBaseImplPrivate *New(const char *_name, FZEntityIDType _value, FZMARGType _type);
    static FZMargBaseImplPrivate *NewStr(const char *_name, const char *_value);
    static FZMargBaseImplPrivate *NewName(const char *_name, const char *_value);
    static FZMargBaseImplPrivate *New(const char *_name, void *_value);
    static FZMargBaseImplPrivate *New(const char *_name, FZMargBaseData *_data, FZMARGType _type);
};

FZMargBaseImplPrivate::~FZMargBaseImplPrivate()
{
    if (user_define_data)
    {
        delete(user_define_data);
    }
    else if (marg_type == FZMARGType::FZ_MARGTYPE_STRING || marg_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        delete[] string_;
    }
    delete[] argument_name;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, FZBOOL _value)
{
    auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = FZMARGType::FZ_MARGTYPE_BOOL;
    marg_base->bool_ = _value;
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, FZIntegerType _value)
{
	auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = FZMARGType::FZ_MARGTYPE_INTEGER;
    marg_base->int_ = _value;
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, FZRealType _value, FZMARGType _type)
{
	auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = _type;
    marg_base->float_ = _value;
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, FZEntityIDType _value, FZMARGType _type)
{
	auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = _type;
    marg_base->id_ = _value;
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::NewStr(const char *_name, const char *_value)
{
    auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);

    marg_base->marg_type = FZMARGType::FZ_MARGTYPE_STRING;
    marg_base->string_ = new_str(_value);
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::NewName(const char *_name, const char *_value)
{
	auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);

    marg_base->marg_type = FZMARGType::FZ_MARGTYPE_NAME;
    marg_base->string_ = new_str(_value, 65);

    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, void *_value)
{
    auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = FZMARGType::FZ_MARGTYPE_ADDRESS;
    marg_base->pointer_ = _value;
    return marg_base;
}

FZMargBaseImplPrivate *FZMargBaseImplPrivate::New(const char *_name, FZMargBaseData *_data, FZMARGType _type)
{

    auto marg_base = new FZMargBaseImplPrivate();
    marg_base->argument_name = new_str(_name);
    marg_base->marg_type = _type;
    marg_base->user_define_data = _data;
    return marg_base;
}

FZMargBaseImpl::FZMargBaseImpl(const char *_name, FZMargBaseData *_data, FZMARGType _type)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _data, _type);
}

FZMargBaseImpl::FZMargBaseImpl(const FZMargBaseImpl &_marg_base_impl)
{
    marg_base_data_ = _marg_base_impl.marg_base_data_;
    _copy_on_write();
}

FZMargBaseImpl::FZMargBaseImpl(const char *_name, FZBOOL _bool)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _bool);
}
FZMargBaseImpl::FZMargBaseImpl(const char *_name, FZIntegerType _int)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _int);
}
FZMargBaseImpl::FZMargBaseImpl(const char *_name, void *_pointer)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _pointer);
}
FZMargBaseImpl::FZMargBaseImpl(const char *_name, const char *_string, FZMARGType _type)
{
    if (_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        marg_base_data_ = FZMargBaseImplPrivate::NewName(_name, _string);
    }
    else
    {
        marg_base_data_ = FZMargBaseImplPrivate::NewStr(_name, _string);
    }
}
FZMargBaseImpl::FZMargBaseImpl(const char *_name, double _float, FZMARGType _type)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _float, _type);
}
FZMargBaseImpl::FZMargBaseImpl(const char *_name, FZEntityIDType _id, FZMARGType _type)
{
    marg_base_data_ = FZMargBaseImplPrivate::New(_name, _id, _type);
}

FZMargBaseImpl::FZMargBaseImpl(const char *_name, FZDMGRC _dmgrc)
{
    marg_base_data_ = new FZMargBaseImplPrivate();
    marg_base_data_->argument_name = new_str(_name);
    marg_base_data_->dmgrc_ = _dmgrc;
    marg_base_data_->marg_type = FZMARGType::FZ_MARGTYPE_DMGRC;
}

FZMargBaseImpl::~FZMargBaseImpl()
{
    delete(marg_base_data_);
}

FZMargBaseImpl *FZMargBaseImpl::Clone()
{
    return new FZMargBaseImpl(*this);
}

void *FZMargBaseImpl::GetValue()
{
    if (marg_base_data_->user_define_data)
    {
        return marg_base_data_->user_define_data->get();
    }
    else if (marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_STRING ||
             marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        return marg_base_data_->string_;
    }
    else if (marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_ADDRESS)
    {
        return marg_base_data_->pointer_;
    }
    else
    {
        return &marg_base_data_->int_;
    }
}

void FZMargBaseImpl::SetValue(void *_value, size_t _size)
{
    if (marg_base_data_->user_define_data)
    {
        if (_value == nullptr)
        {
            return;
        }
        marg_base_data_->user_define_data->set(_value);
    }
    else if (marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_STRING ||
             marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        delete[] marg_base_data_->string_;
        if (marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_NAME)
        {
            marg_base_data_->string_ = new_str((const char *)_value, 65);
        }
        else
        {
            marg_base_data_->string_ = new_str((const char *)_value);
        }
    }
    else
    {
        if (_value == nullptr)
        {
            return;
        }
        switch (marg_base_data_->marg_type)
        {
        case FZMARGType::FZ_MARGTYPE_BOOL:
            marg_base_data_->bool_ = *(FZBOOL *)_value;
            break;
        case FZMARGType::FZ_MARGTYPE_INTEGER:
            marg_base_data_->int_ = *(FZIntegerType *)_value;
            break;
        case FZMARGType::FZ_MARGTYPE_REAL:
        case FZMARGType::FZ_MARGTYPE_JULIAN:
            marg_base_data_->float_ = *(FZRealType *)_value;
            break;
        case FZMARGType::FZ_MARGTYPE_ADDRESS:
            marg_base_data_->pointer_ = _value;
            break;
        default:
            marg_base_data_->id_ = *(FZEntityIDType *)_value;
            break;
        }
    }
}

const char *FZMargBaseImpl::GetName()
{
    return marg_base_data_->argument_name;
}

FZMARGType FZMargBaseImpl::GetType() const
{
    return marg_base_data_->marg_type;
}

void FZMargBaseImpl::SetType(const FZMARGType _type)
{
    marg_base_data_->marg_type = _type;
}

size_t FZMargBaseImpl::GetSize() const
{
    if (marg_base_data_->user_define_data)
    {
        return marg_base_data_->user_define_data->size();
    }
    else if (marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_STRING ||
             marg_base_data_->marg_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        return strlen(marg_base_data_->string_) + 1;
    }
    else
    {
        switch (marg_base_data_->marg_type)
        {
        case FZMARGType::FZ_MARGTYPE_BOOL:
            return sizeof(marg_base_data_->bool_);
            break;
        case FZMARGType::FZ_MARGTYPE_INTEGER:
            return sizeof(marg_base_data_->int_);
            break;
        case FZMARGType::FZ_MARGTYPE_REAL:
        case FZMARGType::FZ_MARGTYPE_JULIAN:
            return sizeof(marg_base_data_->float_);
            break;
        case FZMARGType::FZ_MARGTYPE_ADDRESS:
            return sizeof(marg_base_data_->pointer_);
            break;
        default:
            return sizeof(marg_base_data_->id_);
            break;
        }
    }
}

void FZMargBaseImpl::SetSize(const size_t &_size)
{
}

size_t FZMargBaseImpl::GetCapacity() const
{
    return GetSize();
}

void FZMargBaseImpl::SetLPointer(FZMargBaseImpl *_l_pointer)
{
    prev_ = _l_pointer;
}

void FZMargBaseImpl::SetRPointer(FZMargBaseImpl *_r_pointer)
{
    next_ = _r_pointer;
}

FZMargBaseImpl *FZMargBaseImpl::GetPreviousPointer()
{
    return prev_;
}
FZMargBaseImpl *FZMargBaseImpl::GetNextPointer()
{
    return next_;
}

void FZMargBaseImpl::_copy_on_write()
{
    auto new_data = new FZMargBaseImplPrivate();
    new_data->marg_type = this->marg_base_data_->marg_type;
    new_data->argument_name = new_str(this->marg_base_data_->argument_name);

    if (new_data->marg_type == FZMARGType::FZ_MARGTYPE_STRING)
    {
        new_data->string_ = new_str(this->marg_base_data_->string_);
    }
    else if (new_data->marg_type == FZMARGType::FZ_MARGTYPE_NAME)
    {
        new_data->string_ = new_str(this->marg_base_data_->string_, 65);
    }
    else
    {
        new_data->space_holder_ = this->marg_base_data_->space_holder_;
    }

    if (marg_base_data_->user_define_data)
    {
        new_data->user_define_data = marg_base_data_->user_define_data->clone();
    }

    marg_base_data_ = new_data;
}

FZMargBaseData *FZMargBaseImpl::GetUserDefineData()
{
    return marg_base_data_->user_define_data;
}
