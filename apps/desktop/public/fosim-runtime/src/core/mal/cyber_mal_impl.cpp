#include <map>

#include "core/mal/cyber_mal_impl.h"
#include "core/template/safe_container.h"

struct MargBaseCoordnate : public CyberMargBaseData
{
    CyberCoordinateType coord;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseCoordnate();
        data->coord = coord;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(CyberCoordinateType);
    }
    virtual void *get()
    {
        return &coord;
    }
    virtual void set(void *_coord)
    {
        coord = *(CyberCoordinateType *)(_coord);
    }
};

struct MargBaseVector : public CyberMargBaseData
{
    CyberVectorType vec3;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseVector();
        data->vec3 = vec3;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(CyberVectorType);
    }
    virtual void *get()
    {
        return &vec3;
    }
    virtual void set(void *_coord)
    {
        vec3 = *(CyberVectorType *)(_coord);
    }
};

struct MargBaseOrientation : public CyberMargBaseData
{
    CyberOrientationType ori;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseOrientation();
        data->ori = ori;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(MargBaseOrientation);
    }
    virtual void *get()
    {
        return &ori;
    }
    virtual void set(void *_coord)
    {
        ori = *(CyberOrientationType *)(_coord);
    }
};

struct MargBaseTrackHandle : public CyberMargBaseData
{
    CyberTrackHandleType th;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseTrackHandle();
        data->th = th;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(CyberTrackHandleType);
    }
    virtual void *get()
    {
        return &th;
    }
    virtual void set(void *_coord)
    {
        th = *(CyberTrackHandleType *)(_coord);
    }
};

struct MargBaseTrackHandleList : public CyberMargBaseData
{
    std::vector<CyberTrackHandleType> track_handle_list;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseTrackHandleList();
        data->track_handle_list = track_handle_list;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(CyberTrackHandleType) * track_handle_list.size();
    }
    virtual void *get()
    {
        return &track_handle_list[0];
    }
    virtual void set(void *_coord)
    {
    }
};

struct MargBaseEngagementInfo : public CyberMargBaseData
{
    CyberEngagementInfoType info;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseEngagementInfo();
        data->info = info;
        return data;
    }

    virtual size_t size()
    {
        return sizeof(CyberEngagementInfoType);
    }

    virtual void *get()
    {
        return &info;
    }

    virtual void set(void *_info)
    {
        info = *(CyberEngagementInfoType *)(_info);
    }
};

struct MargBaseMal : public CyberMargBaseData
{
    CyberMalImpl *mal;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseMal();
        data->mal = this->mal->Clone();
        return data;
    }

    virtual size_t size()
    {
        return sizeof(CyberMalImpl);
    }

    virtual void *get()
    {
        return mal;
    }

    virtual void set(void *_info)
    {
        mal->MalDestroy();
        mal = ((CyberMalImpl *)_info)->Clone();
    }

    virtual ~MargBaseMal()
    {
        mal->MalDestroy();
    }
};

struct MargBaseRecord : public CyberMargBaseData
{
    void *data_;
    size_t size_;
    CyberRecordIDType id_;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseRecord();
        data->size_ = size_;
        data->id_ = id_;
        data->data_ = malloc(size_);
        memcpy(data->data_, data_, data->size_);
        return data;
    }

    virtual size_t size()
    {
        return size_;
    }

    virtual void *get()
    {
        return data_;
    }

    virtual void set(void *_info)
    {
        memcpy(data_, _info, size_);
    }
};

struct MargBaseTaskIdList : public CyberMargBaseData
{
    std::vector<CyberTaskIDType> id_list;

    virtual CyberMargBaseData *clone()
    {
        auto data = new MargBaseTaskIdList();
        data->id_list = id_list;
        return data;
    }

    virtual size_t size()
    {
        return id_list.size() * sizeof(CyberTaskIDType);
    }

    virtual void *get()
    {
        return &id_list[0];
    }

    virtual void set(void *_info)
    {
    }
};

std::string ComposeStringForMal(const char *_name, CyberMARGType _marg_type)
{
    std::string compose_string_for_mal = _name;
    switch (_marg_type)
    {
    case CyberMARGType::CYBER_MARGTYPE_INVALID:
        compose_string_for_mal = "";
        break;
    case CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE:
    case CyberMARGType::CYBER_MARGTYPE_ENGAGEMENT_INFO:
    case CyberMARGType::CYBER_MARGTYPE_BOOL:
    case CyberMARGType::CYBER_MARGTYPE_UNITID:
    case CyberMARGType::CYBER_MARGTYPE_EQUIPMENTID:
    case CyberMARGType::CYBER_MARGTYPE_ENTITYID:
    case CyberMARGType::CYBER_MARGTYPE_TRACK_ID:
    case CyberMARGType::CYBER_MARGTYPE_FEATUREID:
    case CyberMARGType::CYBER_MARGTYPE_NAME:
    case CyberMARGType::CYBER_MARGTYPE_INTEGER:
    case CyberMARGType::CYBER_MARGTYPE_COORDINATE:
    case CyberMARGType::CYBER_MARGTYPE_JULIAN:
    case CyberMARGType::CYBER_MARGTYPE_REAL:
    case CyberMARGType::CYBER_MARGTYPE_POSITION:
    case CyberMARGType::CYBER_MARGTYPE_VECTOR:
    case CyberMARGType::CYBER_MARGTYPE_DMGRC:
    case CyberMARGType::CYBER_MARGTYPE_STRING:
    case CyberMARGType::CYBER_MARGTYPE_ADDRESS:
    case CyberMARGType::CYBER_USER_DEFINED:
    case CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST:
    case CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST:
    case CyberMARGType::CYBER_MARGTYPE_RECORD:
    case CyberMARGType::CYBER_MARGTYPE_MAL:
        compose_string_for_mal = compose_string_for_mal + "_" + std::move(std::to_string(_marg_type));
        break;
    default:
        compose_string_for_mal = "";
        break;
    }
    return std::move(compose_string_for_mal);
}

struct CyberMalImplPrivate
{
    CyberMalImplPrivate();
    CyberMalImplPrivate(const CyberMalImplPrivate &_mal);
    ~CyberMalImplPrivate();

    SafeVector<CyberMargBaseImpl *> cyber_marg_impl_list_;
};

CyberMalImplPrivate::CyberMalImplPrivate()
{
}

CyberMalImplPrivate::~CyberMalImplPrivate()
{
    for (CyberMargBaseImpl *base : cyber_marg_impl_list_.get())
    {
        if (base != nullptr)
        {
            delete(base);
            base = nullptr;
        }
    }
}

CyberMalImplPrivate::CyberMalImplPrivate(const CyberMalImplPrivate &_mal)
{
    // 优化: 预分配空间避免频繁重新分配
    size_t size = _mal.cyber_marg_impl_list_.size();
    cyber_marg_impl_list_.get().reserve(size);
    
    for (size_t i = 0; i < size; i++)
    {
        cyber_marg_impl_list_.push_back(_mal.cyber_marg_impl_list_.at(i)->Clone());
    }
    
    for (size_t i = 0; i != cyber_marg_impl_list_.size(); ++i)
    {
        if (i + 1 != cyber_marg_impl_list_.size())
        {
            cyber_marg_impl_list_.at(i)->SetRPointer(cyber_marg_impl_list_.at(i + 1));
        }
        else
        {
            cyber_marg_impl_list_.at(i)->SetRPointer(nullptr);
        }
        if (i != 0)
        {
            cyber_marg_impl_list_.at(i)->SetLPointer(cyber_marg_impl_list_.at(i - 1));
        }
        else
        {
            cyber_marg_impl_list_.at(i)->SetLPointer(nullptr);
        }
    }
}

CyberMalImpl::CyberMalImpl()
    : cyber_mal_impl_private_(new CyberMalImplPrivate())
{
}

CyberMalImpl::CyberMalImpl(const CyberMalImpl &_mal_impl)
    : cyber_mal_impl_private_(new CyberMalImplPrivate(*_mal_impl.cyber_mal_impl_private_))
{
}

CyberMalImpl::CyberMalImpl(CyberMalImpl &&_mal_impl)
{
    cyber_mal_impl_private_ = std::move(_mal_impl.cyber_mal_impl_private_);
    _mal_impl.cyber_mal_impl_private_ = nullptr;
}

CyberMalImpl &CyberMalImpl::operator=(const CyberMalImpl &_mal_impl)
{
    if (&_mal_impl == this)
    {
        return *this;
    }
    if (cyber_mal_impl_private_)
    {
        delete(cyber_mal_impl_private_);
        cyber_mal_impl_private_ = new CyberMalImplPrivate(*_mal_impl.cyber_mal_impl_private_);
    }
    return *this;
}

CyberMalImpl::~CyberMalImpl()
{
    if (cyber_mal_impl_private_)
    {
        delete(cyber_mal_impl_private_);
        cyber_mal_impl_private_ = nullptr;
    }
}

CyberMalImpl *CyberMalImpl::CreateMAL(){
    return new CyberMalImpl();
}

std::vector<CyberMargBaseImpl *> CyberMalImpl::GetMargList() const
{
    std::vector<CyberMargBaseImpl *> margbase_list;
    margbase_list = cyber_mal_impl_private_->cyber_marg_impl_list_.get();
    return margbase_list;
}

void CyberMalImpl::SetMargList(const SafeVector<CyberMargBaseImpl *> &_cyber_marg_impl_list)
{
    for (auto &var : cyber_mal_impl_private_->cyber_marg_impl_list_.get())
    {
        delete(var);
        var = nullptr;
    }
    cyber_mal_impl_private_->cyber_marg_impl_list_.clear();

    cyber_mal_impl_private_->cyber_marg_impl_list_ = _cyber_marg_impl_list;
    for (size_t i = 0; i != cyber_mal_impl_private_->cyber_marg_impl_list_.size(); ++i)
    {
        if (i + 1 != cyber_mal_impl_private_->cyber_marg_impl_list_.size())
        {
            cyber_mal_impl_private_->cyber_marg_impl_list_.at(i)->SetRPointer(cyber_mal_impl_private_->cyber_marg_impl_list_.at(i + 1));
        }
        else
        {
            cyber_mal_impl_private_->cyber_marg_impl_list_.at(i)->SetRPointer(nullptr);
        }

        if (i != 0)
        {
            cyber_mal_impl_private_->cyber_marg_impl_list_.at(i)->SetLPointer(cyber_mal_impl_private_->cyber_marg_impl_list_.at(i - 1));
        }
        else
        {
            cyber_mal_impl_private_->cyber_marg_impl_list_.at(i)->SetLPointer(nullptr);
        }
    }
}

CyberMalImpl *CyberMalImpl::Clone()
{
    return new CyberMalImpl(*this);
}

CyberRC CyberMalImpl::AddAddress(const char *_name, void *_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMARGType marg_type = CyberMARGType::CYBER_MARGTYPE_ADDRESS;

    auto marg = new CyberMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::AddBoolean(const char *_name, const CyberBOOL &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetBoolean(const char *_arg_name, CyberBOOL &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_BOOL);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberBOOL *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddCoordinate(const char *_name, const CyberCoordinateType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto coord_data = new MargBaseCoordnate();
    coord_data->coord = _value;
    auto marg = new CyberMargBaseImpl(_name, coord_data, CyberMARGType::CYBER_MARGTYPE_COORDINATE);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetCoordinate(const char *_arg_name, CyberCoordinateType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_COORDINATE);

    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberCoordinateType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddDMGRC(const char *_name, const CyberDMGRC &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMARGType marg_type = CyberMARGType::CYBER_MARGTYPE_DMGRC;
    auto marg = new CyberMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetDMGRC(const char *_arg_name, CyberDMGRC &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_DMGRC);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberDMGRC *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddEngagementInfo(const char *_name, const CyberEngagementInfoType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto data = new MargBaseEngagementInfo();
    data->info = _value;

    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_ENGAGEMENT_INFO);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetEngagementInfo(const char *_arg_name, CyberEngagementInfoType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_ENGAGEMENT_INFO);

    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberEngagementInfoType *)marg_base->GetValue();

    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddEquipmentID(const char *_name, const CyberEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_EQUIPMENTID);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetEquipmentID(const char *_arg_name, CyberEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_EQUIPMENTID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberEntityIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddEntityID(const char *_name, const CyberEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_ENTITYID);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetEntityID(const char *_arg_name, CyberEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_ENTITYID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberEntityIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddInterID(const char *_name, const CyberInterIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_INTERID);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetInterID(const char *_arg_name, CyberInterIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_INTERID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberInterIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddFeatureID(const char *_name, const CyberFeatureIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_FEATUREID);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetFeatureID(const char *_arg_name, CyberFeatureIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_FEATUREID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberFeatureIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddInteger(const char *_name, const CyberIntegerType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMARGType marg_type = CyberMARGType::CYBER_MARGTYPE_INTEGER;
    auto marg = new CyberMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetInteger(const char *_arg_name, CyberIntegerType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_INTEGER);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberIntegerType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddJulian(const char *_name, const CyberJulianType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_JULIAN);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetJulian(const char *_arg_name, CyberJulianType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_JULIAN);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberJulianType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddMal(const char *_name, CyberMalImpl *_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto data = new MargBaseMal();
    data->mal = _value->Clone();

    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_MAL);
    return AddArgument(marg);
}

CyberMalImpl *CyberMalImpl::GetMal(const char *_arg_name)
{
    if (_arg_name == nullptr)
    {
        return nullptr;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_MAL);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return (CyberMalImpl *)marg_base->GetValue();
}

CyberRC CyberMalImpl::GetMal(const char *_arg_name, CyberMalImpl *&_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_MAL);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = (CyberMalImpl *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddRecord(const char *_name, void *_record, size_t _record_size, CyberRecordIDType _record_id /*= 0*/)
{
    if (_name == nullptr || _record == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    MargBaseRecord data;
    data.data_ = _record;
    data.id_ = _record_id;
    data.size_ = _record_size;

    auto marg = new CyberMargBaseImpl(_name, data.clone(), CyberMARGType::CYBER_MARGTYPE_RECORD);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetRecord(const char *_name, void *_record, size_t &_record_size, CyberRecordIDType &_record_id)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_RECORD);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    memcpy(_record, marg_base->GetValue(), marg_base->GetCapacity());
    _record_size = marg_base->GetSize();
    _record_id = 0;
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddTaskIdList(const char *_name, const CyberTaskIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        auto data = new MargBaseTaskIdList();
        data->id_list.push_back(_value);
        auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST);
        return AddArgument(marg);
    }
    else
    {
        auto data = marg_base->GetUserDefineData();
        auto task_id_list_data = dynamic_cast<MargBaseTaskIdList *>(data);
        if (task_id_list_data)
        {
            task_id_list_data->id_list.push_back(_value);
        }
    }
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddName(const char *_name, const char *_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_NAME);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetName(const char *_arg_name, char *_name)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_NAME);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    char *name = (char *)GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_NAME)->GetValue();
    strcpy(_name, name);
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddPosition(const char *_name, const CyberPositionType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto data = new MargBaseVector();
    data->vec3 = _value;
    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_POSITION);

    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetPosition(const char *_arg_name, CyberPositionType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_POSITION);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberPositionType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddReal(const char *_name, const CyberRealType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_REAL);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetReal(const char *_arg_name, CyberRealType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_REAL);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberRealType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddTrackHandle(const char *_name, const CyberTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto data = new MargBaseTrackHandle();
    data->th = _value;

    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetTrackHandle(const char *_arg_name, CyberTrackHandleType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberTrackHandleType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddTrackID(const char *_name, const CyberTrackIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_TRACK_ID);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::AddUnitID(const char *_name, const CyberEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_UNITID);

    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetUnitID(const char *_arg_name, CyberEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_UNITID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberEntityIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddVector(const char *_name, const CyberVectorType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto data = new MargBaseVector();
    data->vec3 = _value;

    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_VECTOR);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetOrientation(const char *_arg_name, CyberOrientationType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_ORIENTATION);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberOrientationType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddOrientation(const char *_name, const CyberOrientationType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    auto data = new MargBaseOrientation();
    data->ori = _value;

    auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_ORIENTATION);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetVector(const char *_arg_name, CyberVectorType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_VECTOR);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberVectorType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddString(const char *_name, const char *_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto marg = new CyberMargBaseImpl(_name, _value, CyberMARGType::CYBER_MARGTYPE_STRING);
    return AddArgument(marg);
}

const char *CyberMalImpl::GetString(const char *_arg_name)
{
    if (_arg_name == nullptr)
    {
        return nullptr;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_STRING);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return (char *)marg_base->GetValue();
}

CyberRC CyberMalImpl::GetString(const char *_arg_name, char *&_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_STRING);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = (char *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddTrackHandleList(const char *_name, const CyberTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST);

    if (marg_base == nullptr)
    {
        auto data = new MargBaseTrackHandleList();
        data->track_handle_list.push_back(_value);

        auto marg = new CyberMargBaseImpl(_name, data, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST);
        return AddArgument(marg);
    }
    else
    {
        auto data = dynamic_cast<MargBaseTrackHandleList *>(marg_base->GetUserDefineData());
        data->track_handle_list.push_back(_value);
    }
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::GetTrackHandleList(const char *_name, size_t _index, CyberTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    size_t max_index = marg_base->GetSize() / sizeof(CyberTrackHandleType) - 1;
    if (_index > max_index)
    {
        return CYBER_FAILURE;
    }
    _value = *(CyberTrackHandleType *)((CyberTrackHandleType *)marg_base->GetValue() + _index);

    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::GetTrackHandleListSize(const char *_name, size_t &_size)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST);
    if (marg_base == nullptr)
    {
        _size = 0;
        return CyberRC::CYBER_FAILURE;
    }
    _size = marg_base->GetSize() / sizeof(CyberTrackHandleType);
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddPODData(const char *_name, void *_pod_data, size_t _pod_data_size)
{
    if (_name == nullptr || _pod_data == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    MargBaseRecord data;
    data.data_ = _pod_data;
    data.size_ = _pod_data_size;
    data.id_ = 0;

    auto marg = new CyberMargBaseImpl(_name, data.clone(), CyberMARGType::CYBER_USER_DEFINED);
    return AddArgument(marg);
}

CyberRC CyberMalImpl::GetPODData(const char *_name, void *_pod_data, size_t &_pod_data_size)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_name, CyberMARGType::CYBER_USER_DEFINED);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    memcpy(_pod_data, marg_base->GetValue(), marg_base->GetCapacity());
    _pod_data_size = marg_base->GetSize();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AppendMal(CyberMalImpl *_mal_value)
{
    if (nullptr == _mal_value)
    {
        return CyberRC::CYBER_FAILURE;
    }

    auto &input_list = _mal_value->cyber_mal_impl_private_->cyber_marg_impl_list_.get();
    for (CyberMargBaseImpl *var : input_list)
    {
        CyberMargBaseImpl *new_marg = var->Clone();
        AddArgument(new_marg);
    }

    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::MalDestroy()
{
    CyberRC rt = CyberRC::CYBER_FAILURE;

    rt = DropArgumentList();

    delete this;
    return rt;
}

CyberRC CyberMalImpl::DropArgument(CyberMargBaseImpl *_marg_value)
{
    for (auto iter = cyber_mal_impl_private_->cyber_marg_impl_list_.get().begin();
         iter != cyber_mal_impl_private_->cyber_marg_impl_list_.get().end();)
    {
        if (*iter == _marg_value)
        {
            iter = cyber_mal_impl_private_->cyber_marg_impl_list_.get().erase(iter);
            delete(_marg_value);
            return CyberRC::CYBER_SUCCESS;
        }
        else
        {
            iter++;
        }
    }
    return CyberRC::CYBER_FAILURE;
}

CyberRC CyberMalImpl::DropArgumentByName(const char *_name, CyberMARGType _marg_type)
{
    CyberRC rt = CyberRC::CYBER_FAILURE;
    for (auto jtor = cyber_mal_impl_private_->cyber_marg_impl_list_.get().begin();
         jtor != cyber_mal_impl_private_->cyber_marg_impl_list_.get().end(); ++jtor)
    {
        if (strcmp(_name, (*jtor)->GetName()) == 0 && _marg_type == (*jtor)->GetType())
        {

            //删除
            if (jtor != cyber_mal_impl_private_->cyber_marg_impl_list_.get().begin() && (jtor + 1) != cyber_mal_impl_private_->cyber_marg_impl_list_.get().end())
            {
                (*(jtor - 1))->SetRPointer(*(jtor + 1));
                (*(jtor + 1))->SetLPointer(*(jtor - 1));
            }
            else if (jtor == cyber_mal_impl_private_->cyber_marg_impl_list_.get().begin())
            {
                (*(jtor + 1))->SetLPointer(nullptr);
            }
            else if ((jtor + 1) == cyber_mal_impl_private_->cyber_marg_impl_list_.get().end())
            {
                (*(jtor - 1))->SetRPointer(nullptr);
            }
            else
            {
                //出错；
            }

            cyber_mal_impl_private_->cyber_marg_impl_list_.get().erase(jtor);
            rt = CyberRC::CYBER_SUCCESS;
            break;
        }
    }
    return rt;
}

CyberRC CyberMalImpl::DropArgumentList()
{
    if (cyber_mal_impl_private_->cyber_marg_impl_list_.get().empty())
    {
        return CyberRC::CYBER_FAILURE;
    }

    for (auto &var : cyber_mal_impl_private_->cyber_marg_impl_list_.get())
    {
        delete(var);
        var = nullptr;
    }

    cyber_mal_impl_private_->cyber_marg_impl_list_.get().clear();
    return CyberRC::CYBER_SUCCESS;
}

CyberMargBaseImpl *CyberMalImpl::GetArgumentByName(const char *_arg_name, CyberMARGType _arg_type)
{
    if(!this)
        return nullptr;
    if (cyber_mal_impl_private_->cyber_marg_impl_list_.get().empty())
    {
        return nullptr;
    }
    for (auto &var : cyber_mal_impl_private_->cyber_marg_impl_list_.get())
    {
        if (strcmp(_arg_name, var->GetName()) == 0 && _arg_type == var->GetType())
        {
            return var;
        }
    }
    return nullptr;
}

CyberMargBaseImpl *CyberMalImpl::GetFirstArgument()
{
    if (cyber_mal_impl_private_->cyber_marg_impl_list_.get().empty())
    {
        return nullptr;
    }
    return *cyber_mal_impl_private_->cyber_marg_impl_list_.get().begin();
}

CyberMargBaseImpl *CyberMalImpl::GetLastArgument()
{
    return cyber_mal_impl_private_->cyber_marg_impl_list_.get().back();
}

CyberMargBaseImpl *CyberMalImpl::GetNextArgument(CyberMargBaseImpl *_current_arg)
{
    return _current_arg->GetNextPointer();
}

CyberMargBaseImpl *CyberMalImpl::GetPreviousArgument(CyberMargBaseImpl *_current_arg)
{
    return _current_arg->GetPreviousPointer();
}

CyberRC CyberMalImpl::SerializeMal(void **_ptr, size_t &_size, size_t _pre_malloc_size)
{
    size_t seralize_size = this->GetSerializeSize();

    if (seralize_size == 0)
    {
        return CyberRC::CYBER_FAILURE;
    }

    *_ptr = malloc(seralize_size);
    _size = Serialize(this, *_ptr);

    return _size > 0 ? CyberRC::CYBER_SUCCESS : CyberRC::CYBER_FAILURE;
}

CyberRC CyberMalImpl::DeSerializeMal(void *_ptr, size_t _real_size)
{
    if (_real_size == 0)
    {
        return CyberRC::CYBER_FAILURE;
    }
    return DeSerialize(this, _ptr);
}

size_t CyberMalImpl::GetSerializeSize()
{
    return GetSerializeSize(this);
}

size_t CyberMalImpl::GetSerializeSize(CyberMalImpl *_mal)
{
    size_t total_size = 0;
    for (auto var : _mal->cyber_mal_impl_private_->cyber_marg_impl_list_.get())
    {
        total_size += sizeof(size_t);
        total_size += sizeof(size_t);
        total_size += sizeof(CyberMARGType);
        total_size += sizeof(size_t);
        total_size += strlen(var->GetName());

        if (var->GetType() == CyberMARGType::CYBER_MARGTYPE_MAL)
        {
            total_size += GetSerializeSize((CyberMalImpl *)var->GetValue());
        }
        else
        {
            total_size += var->GetSize();
        }
    }
    return total_size;
}

size_t CyberMalImpl::Serialize(const CyberMalImpl *_mal, void *_ptr)
{
    if (_ptr == nullptr)
    {
        return 0;
    }

    size_t serialize_size = GetSerializeSize();
    char *data = (char *)(_ptr);
    size_t index = 0;

    size_t *member_count = (size_t *)&data[index];
    index += sizeof(size_t);
    *member_count = _mal->cyber_mal_impl_private_->cyber_marg_impl_list_.get().size();

    for (auto var : _mal->cyber_mal_impl_private_->cyber_marg_impl_list_.get())
    {
        size_t *name_len = (size_t *)&data[index];
        index += sizeof(size_t);

        CyberMARGType *marg_type = (CyberMARGType *)&data[index];
        index += sizeof(CyberMARGType);

        size_t *data_len = (size_t *)&data[index];
        index += sizeof(size_t);

        *marg_type = var->GetType();
        *name_len = strlen(var->GetName());
        memcpy(&data[index], var->GetName(), *name_len);
        index += *name_len;
        if (var->GetType() == CyberMARGType::CYBER_MARGTYPE_MAL)
        {
            *data_len = GetSerializeSize((CyberMalImpl *)var->GetValue());
            Serialize((CyberMalImpl *)var->GetValue(), &data[index]);
        }
        else if (var->GetType() == CyberMARGType::CYBER_MARGTYPE_ADDRESS)
        {
            *data_len = sizeof(void *);
            void *pointer_value = var->GetValue();
            memcpy(&data[index], &pointer_value, *data_len);
        }
        else
        {
            *data_len = var->GetSize();
            memcpy(&data[index], var->GetValue(), *data_len);
        }
        index += *data_len;
    }
    return serialize_size;
}

CyberRC CyberMalImpl::DeSerialize(CyberMalImpl *_mal, void *_ptr)
{
    _mal->DropArgumentList();

    char *data = (char *)_ptr;
    size_t index = 0;
    size_t *member_count = (size_t *)&data[index];
    index += sizeof(size_t);

    size_t *name_len = nullptr;
    size_t *data_len = nullptr;
    CyberMARGType *data_type = nullptr;
    char *data_ptr = nullptr;
    char marg_name[256] = {0};
    CyberMargBaseImpl *new_marg = nullptr;
    for (size_t i = 0; i < *member_count; i++)
    {
        name_len = (size_t *)&data[index];
        index += sizeof(size_t);

        data_type = (CyberMARGType *)&data[index];
        index += sizeof(CyberMARGType);

        data_len = (size_t *)&data[index];
        index += sizeof(size_t);

        memcpy(marg_name, &data[index], *name_len > 255 ? 255 : *name_len);
        marg_name[*name_len] = 0;
        index += *name_len;

        data_ptr = &data[index];
        index += *data_len;

        if (*data_type == CyberMARGType::CYBER_MARGTYPE_MAL)
        {
            auto new_mal = CyberMalImpl::CreateMAL();
            if (*data_len > 0)
            {
                DeSerialize(new_mal, data_ptr);
            }
            auto data = new MargBaseMal();
            data->mal = new_mal;
            new_marg = new CyberMargBaseImpl(marg_name, data, *data_type);
        }
        else
        {
            switch (*data_type)
            {
            case CyberMARGType::CYBER_MARGTYPE_ADDRESS:
                new_marg = new CyberMargBaseImpl(marg_name, *(void **)data_ptr);
                break;
            case CyberMARGType::CYBER_MARGTYPE_BOOL:
                new_marg = new CyberMargBaseImpl(marg_name, *(CyberBOOL *)data_ptr);
                break;
            case CyberMARGType::CYBER_MARGTYPE_COORDINATE:
            {
                auto marg_base_data = new MargBaseCoordnate();
                marg_base_data->coord = *(CyberCoordinateType *)data_ptr;
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_DMGRC:
                new_marg = new CyberMargBaseImpl(marg_name, *(CyberDMGRC *)data_ptr);
                break;
            case CyberMARGType::CYBER_MARGTYPE_ENGAGEMENT_INFO:
            {
                auto marg_base_data = new MargBaseEngagementInfo();
                marg_base_data->info = *(CyberEngagementInfoType *)data_ptr;
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_ENTITYID:
            case CyberMARGType::CYBER_MARGTYPE_EQUIPMENTID:
            case CyberMARGType::CYBER_MARGTYPE_FEATUREID:
            case CyberMARGType::CYBER_MARGTYPE_INTERID:
            case CyberMARGType::CYBER_MARGTYPE_TRACK_ID:
            case CyberMARGType::CYBER_MARGTYPE_UNITID:
                new_marg = new CyberMargBaseImpl(marg_name, *(CyberEntityIDType *)data_ptr, *data_type);
                break;
            case CyberMARGType::CYBER_MARGTYPE_INTEGER:
                new_marg = new CyberMargBaseImpl(marg_name, *(CyberIntegerType *)data_ptr);
                break;
            case CyberMARGType::CYBER_MARGTYPE_JULIAN:
            case CyberMARGType::CYBER_MARGTYPE_REAL:
				new_marg = new CyberMargBaseImpl(marg_name, *(CyberRealType *)data_ptr, *data_type);
                break;
            case CyberMARGType::CYBER_MARGTYPE_NAME:
            case CyberMARGType::CYBER_MARGTYPE_STRING:
                new_marg = new CyberMargBaseImpl(marg_name, data_ptr, *data_type);
                break;
            case CyberMARGType::CYBER_MARGTYPE_ORIENTATION:
            {
                auto marg_base_data = new MargBaseOrientation();
                marg_base_data->ori = *(CyberOrientationType *)data_ptr;
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_POSITION:
            case CyberMARGType::CYBER_MARGTYPE_VECTOR:
            {
                auto marg_base_data = new MargBaseVector();
                marg_base_data->vec3 = *(CyberVectorType *)data_ptr;
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_RECORD:
            case CyberMARGType::CYBER_USER_DEFINED:
            {
                MargBaseRecord record;
                record.data_ = data_ptr;
                record.size_ = *data_len;
                record.id_ = 0;
                new_marg = new CyberMargBaseImpl(marg_name, record.clone(), *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST:
            {
                size_t count = *data_len / sizeof(CyberTaskIDType);
                auto marg_base_data = new MargBaseTaskIdList();
                marg_base_data->id_list.resize(count);
                memcpy(&marg_base_data->id_list[0], data_ptr, *data_len);
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE:
            {
                auto marg_base_data = new MargBaseTrackHandle();
                marg_base_data->th = *(CyberTrackHandleType *)data_ptr;
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            case CyberMARGType::CYBER_MARGTYPE_TRACK_HANDLE_LIST:
            {
                size_t count = *data_len / sizeof(CyberTrackHandleType);
                auto marg_base_data = new MargBaseTrackHandleList();
                marg_base_data->track_handle_list.resize(count);
                memcpy(&marg_base_data->track_handle_list[0], data_ptr, *data_len);
                new_marg = new CyberMargBaseImpl(marg_name, marg_base_data, *data_type);
                break;
            }
            default:
                break;
            }
        }

        _mal->AddArgument(new_marg);
    }
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::AddArgument(CyberMargBaseImpl *_margs)
{
    if (nullptr == _margs)
    {
        return CyberRC::CYBER_FAILURE;
    }

    if (cyber_mal_impl_private_->cyber_marg_impl_list_.empty())
    {
        cyber_mal_impl_private_->cyber_marg_impl_list_.emplace_back(_margs);
    }
    else
    {
        cyber_mal_impl_private_->cyber_marg_impl_list_.back()->SetRPointer(_margs);
        _margs->SetLPointer(cyber_mal_impl_private_->cyber_marg_impl_list_.get().back());
        cyber_mal_impl_private_->cyber_marg_impl_list_.emplace_back(_margs);
    }
    return CyberRC::CYBER_SUCCESS;
}

void *CyberMalImpl::GetAddress(const char *_name)
{
    if (_name == nullptr)
    {
        return nullptr;
    }
    if(this == nullptr)
    {
        return nullptr;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_ADDRESS);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return marg_base->GetValue();
}

CyberRC CyberMalImpl::GetAddress(const char *_name, void *&_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_ADDRESS);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::GetTrackID(const char *_arg_name, CyberTrackIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    CyberMargBaseImpl *marg_base = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_TRACK_ID);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    _value = *(CyberTrackIDType *)marg_base->GetValue();
    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::GetTaskIdList(const char *_name, size_t _index, CyberTaskIDType &_value)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }

    CyberMargBaseImpl *marg_base = GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    //找到；
    size_t max_index = marg_base->GetSize() / sizeof(CyberTaskIDType) - 1;
    if (_index > max_index)
    {
        return CYBER_FAILURE;
    }
    _value = *(CyberTaskIDType *)((CyberTaskIDType *)marg_base->GetValue() + _index);

    return CyberRC::CYBER_SUCCESS;
}

CyberRC CyberMalImpl::GetTaskIdListSize(const char *_name, size_t &_size)
{
    if (_name == nullptr)
    {
        return CyberRC::CYBER_FAILURE;
    }
    CyberMargBaseImpl *marg_base = (CyberMargBaseImpl *)GetArgumentByName(_name, CyberMARGType::CYBER_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        _size = 0;
        return CyberRC::CYBER_FAILURE;
    }
    _size = marg_base->GetSize() / sizeof(CyberTaskIDType);
    return CyberRC::CYBER_SUCCESS;
}

CyberBOOL CyberMalImpl::GetBoolean(const char *_arg_name, CyberRC *_res)
{
    CyberBOOL res;
    if (_res)
    {
        *_res = GetBoolean(_arg_name, res);
    }
    else
    {
        GetBoolean(_arg_name, res);
    }
    return res;
}

CyberCoordinateType CyberMalImpl::GetCoordinate(const char *_arg_name, CyberRC *_res)
{
    CyberCoordinateType res;
    if (_res)
    {
        *_res = GetCoordinate(_arg_name, res);
    }
    else
    {
        GetCoordinate(_arg_name, res);
    }
    return res;
}

CyberDMGRC CyberMalImpl::GetDMGRC(const char *_arg_name, CyberRC *_res)
{
    CyberDMGRC res = CYBER_DMGRC_UNKNOWN;
    if (_res)
    {
        *_res = GetDMGRC(_arg_name, res);
    }
    else
    {
        GetDMGRC(_arg_name, res);
    }
    return res;
}

CyberEntityIDType CyberMalImpl::GetEquipmentID(const char *_arg_name, CyberRC *_res)
{
    CyberEntityIDType res = 0;
    if (_res)
    {
        *_res = GetEquipmentID(_arg_name, res);
    }
    else
    {
        GetEquipmentID(_arg_name, res);
    }
    return res;
}

CyberEntityIDType CyberMalImpl::GetEntityID(const char *_arg_name, CyberRC *_res)
{
    CyberEntityIDType res = 0;
    if (_res)
    {
        *_res = GetEntityID(_arg_name, res);
    }
    else
    {
        GetEntityID(_arg_name, res);
    }
    return res;
}

CyberInterIDType CyberMalImpl::GetInterID(const char *_arg_name, CyberRC *_res)
{
    CyberInterIDType res = 0;
    if (_res)
    {
        *_res = GetInterID(_arg_name, res);
    }
    else
    {
        GetInterID(_arg_name, res);
    }
    return res;
}

CyberFeatureIDType CyberMalImpl::GetFeatureID(const char *_arg_name, CyberRC *_res)
{
    CyberFeatureIDType res = 0;
    if (_res)
    {
        *_res = GetFeatureID(_arg_name, res);
    }
    else
    {
        GetFeatureID(_arg_name, res);
    }
    return res;
}

CyberIntegerType CyberMalImpl::GetInteger(const char *_arg_name, CyberRC *_res)
{
    CyberIntegerType res = 0;
    if (_res)
    {
        *_res = GetInteger(_arg_name, res);
    }
    else
    {
        GetInteger(_arg_name, res);
    }
    return res;
}

CyberJulianType CyberMalImpl::GetJulian(const char *_arg_name, CyberRC *_res)
{
    CyberJulianType res = 0;
    if (_res)
    {
        *_res = GetJulian(_arg_name, res);
    }
    else
    {
        GetJulian(_arg_name, res);
    }
    return res;
}

CyberTrackIDType CyberMalImpl::GetTrackID(const char *_name, CyberRC *_res)
{
    CyberTrackIDType res = 0;
    if (_res)
    {
        *_res = GetTrackID(_name, res);
    }
    else
    {
        GetTrackID(_name, res);
    }
    return res;
}

CyberEntityIDType CyberMalImpl::GetUnitID(const char *_name, CyberRC *_res)
{
    CyberEntityIDType res = 0;
    if (_res)
    {
        *_res = GetUnitID(_name, res);
    }
    else
    {
        GetUnitID(_name, res);
    }
    return res;
}

CyberOrientationType CyberMalImpl::GetOrientation(const char *_arg_name, CyberRC *_res)
{
    CyberOrientationType res;
    if (_res)
    {
        *_res = GetOrientation(_arg_name, res);
    }
    else
    {
        GetOrientation(_arg_name, res);
    }
    return res;
}

CyberVectorType CyberMalImpl::GetVector(const char *_arg_name, CyberRC *_res)
{
    CyberVectorType res;
    if (_res)
    {
        *_res = GetVector(_arg_name, res);
    }
    else
    {
        GetVector(_arg_name, res);
    }
    return res;
}

CyberRealType CyberMalImpl::GetReal(const char *_arg_name, CyberRC *_res)
{
    CyberRealType res = 0;
    if (_res)
    {
        *_res = GetReal(_arg_name, res);
    }
    else
    {
        GetReal(_arg_name, res);
    }
    return res;
}

const char *CyberMalImpl::GetName(const char *_arg_name)
{
    if (_arg_name == nullptr){
        return "";
    }
    auto marg = GetArgumentByName(_arg_name, CyberMARGType::CYBER_MARGTYPE_NAME);
    if(marg == nullptr){
        return "";
    }
    return (const char *)marg->GetValue();
}

CyberPositionType CyberMalImpl::GetPosition(const char *_arg_name, CyberRC *_res)
{
    CyberPositionType res;
    if (_res)
    {
        *_res = GetPosition(_arg_name, res);
    }
    else
    {
        GetPosition(_arg_name, res);
    }
    return res;
}
